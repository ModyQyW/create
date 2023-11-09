#!/usr/bin/env node
import { Command } from "commander";
import consola from "consola";
import packageJson from "../package.json";
import { Listr } from "listr2";
import { ListrInquirerPromptAdapter } from "@listr2/prompt-adapter-inquirer";
import { input, select } from "@inquirer/prompts";
import updateNotifier from "update-notifier";
import { $ } from "execa";
import semver from "semver";
import got from "got";

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
  templates: { value: string; description: string }[];
  template: string;
}

const program = new Command()
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .argument("<string>", "dir to pull templates")
  .option("-t, --template <string>", "Pick a template.")
  .parse();
const args = program.args;
const opts = program.opts();
// console.log("args", program.args);
// console.log("opts", program.opts());

const installLtsWithFnm = (ctx: Ctx) => {
  $`fnm install ${ctx.ltsMajor} && fnm alias ${ctx.ltsMajor} default`.catch(
    () => {
      throw new Error(
        `Node.js LTS cannot be installed automatically. Please install https://github.com/schniz/fnm, or manually install Node.js LTS ${ctx.ltsVersion}.`
      );
    }
  );
};
const tasks = new Listr<Ctx>([
  {
    title: "Fetch Node.js versions, latest LTS and latest LTS major",
    retry: 1,
    task: async (ctx) => {
      try {
        ctx.nodeVersions = await got(
          "https://nodejs.org/dist/index.json"
        ).json();
        ctx.ltsVersion = ctx.nodeVersions.find((v) => v.lts)!.version;
        ctx.ltsMajor = semver.major(ctx.ltsVersion);
      } catch {
        throw new Error(
          "Can not fetch the Node.js versions. Please check your network."
        );
      }
    },
  },
  {
    title: "Check Node.js",
    retry: 1,
    task: async (ctx) => {
      // Node.js exist => get current version and current major
      // Node.js not exist => try install LTS with fnm
      try {
        ctx.currentVersion = (await $`node -v`).stdout;
        ctx.currentMajor = semver.major(ctx.currentVersion);
      } catch {
        installLtsWithFnm(ctx);
      }
      // Compare current major and LTS major
      // same => do nothing
      // not same => try install LTS with fnm
      if (ctx.currentMajor !== ctx.ltsMajor) installLtsWithFnm(ctx);
    },
  },
  {
    title: "Fetch templates",
    retry: 1,
    task: async (ctx) => {
      try {
        ctx.templates = await got(
          "https://raw.githubusercontent.com/modyqyw/create/main/meta.json"
        ).json();
      } catch {
        throw new Error(
          "Can not fetch the templates. Please check your network."
        );
      }
    },
  },
  {
    title: "Pick a template",
    rendererOptions: {
      persistentOutput: true,
    },
    task: async (ctx, task) => {
      if (
        opts.template &&
        ctx.templates.find((p) => p.value.split("✅ ").at(-1) === opts.template)
      ) {
        ctx.template = opts.template;
        task.output = `Picked ${opts.template}`;
        return task.skip();
      }
      const template = (await task
        .prompt(ListrInquirerPromptAdapter)
        .run(select, {
          message: "Please pick a template (✅ means recommended)",
          choices: ctx.templates,
        })) as string;
      ctx.template = template;
      task.output = `Picked ${template}`;
    },
  },
  {
    title: "Pull the template",
    retry: 1,
    task: async (ctx, task) => {
      let dir =
        args[0] ||
        (await task.prompt(ListrInquirerPromptAdapter).run(input, {
          message: "Please input a folder name",
        }));
      await $`pnpx tiged ModyQyW/create/templates/${ctx.template} ${dir}`;
    },
  },
]);
tasks.run().catch((error) => {
  consola.error(error);
  process.exit(1);
});
