import { args, context, main } from "./lib.mjs";

main(async () => {
  const options = args(process.argv.slice(2), [
    "--env-file",
    "--project-name",
    "--ingress",
  ]);
  const ctx = await context(options);
  await ctx.docker(["version", "--short"]);
  console.log(
    "Production environment and Compose configuration are valid. No services were changed.",
  );
});
