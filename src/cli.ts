#!/usr/bin/env node
import meow from "meow";
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

const cli = meow({
  importMeta: import.meta,
  autoHelp: false,
  autoVersion: false,
  flags: {
    template: {
      type: "string",
      shortFlag: "t",
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
	  $ mc <dir>
	  $ modyqyw-create <dir>
    $ pnpm create @modyqyw@latest

	Options
    --template, -t  Pick a template.
    --help, -h      Show the help text.
    --version, -v   Show the version text.
`,
});

const { input: cliInput, flags: cliFlags, showHelp, showVersion } = cli;
console.log("cliInput", cliInput);
console.log("cliFlags", cliFlags);
if (cliFlags.help) showHelp();
if (cliFlags.version) showVersion();

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
    task: async (ctx, task) => {
      if (
        cliFlags.template &&
        ctx.templates.find((p) => p.name === cliFlags.template)
      ) {
        ctx.template = cliFlags.template;
        return task.skip();
      }
      const template = (await task
        .prompt(ListrInquirerPromptAdapter)
        .run(select, {
          message: "Please pick a template (✅ means recommended)",
          choices: ctx.templates,
        })) as string;
      ctx.template = template;
      task.output = `Picked template: ${template}`;
    },
  },
  {
    title: "Pull the template",
    retry: 1,
    task: async (ctx, task) => {
      let dir =
        cliInput[0] ||
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
