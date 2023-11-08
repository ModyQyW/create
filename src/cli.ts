#!/usr/bin/env node
import meow from "meow";
import consola from "consola";
import packageJson from "../package.json";
import { Listr } from "listr2";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import updateNotifier from "update-notifier";
import { $ } from "execa";
import semver from "semver";
import got from "got";
import {resolve, isAbsolute} from 'node:path'
import {existsSync} from 'node:fs'

updateNotifier({ pkg: packageJson }).notify();

interface Ctx {
  nodeVersions: {
    version: string;
    date: string;
    files: string[];
    npm: string;
    v8: string;
    uv: string;
    zlib: string;
    openssl: string;
    modules: string;
    lts: boolean;
    security: boolean;
  }[];
  ltsVersion: string;
  ltsMajor: number;
  currentVersion: string;
  currentMajor: number;
  templates: { name: string; desc: string }[];
  template: string;
}

const cli = meow({
  importMeta: import.meta,
  autoHelp: false,
  autoVersion: false,
  flags: {
    template: {
      type: "string",
      shortFlag: "p",
      choices: ["vue-naive", "koa (prototype only)"],
    },
    help: {
      type: "boolean",
      shortFlag: "h",
    },
    version: {
      type: "boolean",
      shortFlag: "v",
    },
  },
  help: `
	Usage
	  $ foo <dir>

	Options
    --help, -h  Show the help text.
    --version, -v  Show the version text.

	Examples
	  $ foo unicorns --rainbow
	  🌈 unicorns 🌈
`,
});

const { input, flags, showHelp, showVersion } = cli;
console.log("input", input);
console.log("flags", flags);
if (flags.help) showHelp();
if (flags.version) showVersion();

const installLtsWithFnm = (ctx: Ctx) => {
  $`fnm install ${ctx.ltsMajor} && fnm alias ${ctx.ltsMajor} default`.catch(
    () => {
      throw new Error(
        `无法使用 fnm 自动安装。请先安装 https://github.com/Schniz/fnm，或手动安装 Node LTS ${ctx.ltsVersion}。`
      );
    }
  );
};
const tasks = new Listr<Ctx>([
  {
    title: "获取 Node 版本列表、最新 LTS 版本、最新 LTS major",
    retry: 1,
    task: async (ctx) => {
      try {
        ctx.nodeVersions = await got(
          "https://nodejs.org/dist/index.json"
        ).json();
        ctx.ltsVersion = ctx.nodeVersions.find((v) => v.lts)!.version;
        ctx.ltsMajor = semver.major(ctx.ltsVersion);
      } catch {
        throw new Error("无法获取 Node 版本列表，请检查网络。");
      }
    },
  },
  {
    title: "检查 Node",
    task: async (ctx, task) => {
      // 检查是否存在
      // 存在则获取当前版本和当前 major
      // 不存在则尝试使用 fnm 自动安装
      try {
        ctx.currentVersion = (await $`node -v`).stdout;
        ctx.currentMajor = semver.major(ctx.currentVersion);
      } catch {
        installLtsWithFnm(ctx);
      }
      // 核对当前 major 和 LTS major
      // 一致不做操作
      // 不一致尝试使用 fnm 自动安装
      if (ctx.currentMajor !== ctx.ltsMajor) installLtsWithFnm(ctx);
    },
  },
  {
    title: "获取模板列表",
    task: async (ctx, task) => {
      try {
        ctx.templates = await got(
          "https://raw.githubusercontent.com/modyqyw/create/main/meta.json"
        ).json();
      } catch {
        throw new Error("无法获取模板列表，请检查网络。");
      }
    },
  },
  {
    title: "选择模板",
    task: async (ctx, task) => {
      if (flags.template && ctx.templates.find((p) => p.name === flags.template)) {
        ctx.template = flags.template;
        return task.skip();
      }
      const template = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
        type: "Select",
        message: "请选择模板，✅ 表示推荐",
        choices: ctx.templates.map((p) => ({
          name: p.name,
          value: p.name,
          message: p.desc,
        })),
      });
      ctx.template = template;
    },
  },
  {
    title: "拉取模板",
    task: async (ctx, task) => {
      let dir = input[0] || await task.prompt(ListrEnquirerPromptAdapter).run<string>({
        type: "Input",
        message: '请填写文件夹名称，如 .（英文句号，表示拉取模板内容到当前路径）、test-create（表示拉取模板内容到 test-create 文件夹内），自动创建',
      })
      await $`pnpx tiged ModyQyW/create/templates/${ctx.template} ${dir}`
    },
  },
]);
tasks.run().catch((error) => {
  consola.error(error);
  process.exit(1);
});
