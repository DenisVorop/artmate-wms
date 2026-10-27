import { args, context, required, backup, main } from "./lib.mjs";

main(async () => {
  const options = args(process.argv.slice(2), [
    "--env-file",
    "--project-name",
    "--output",
  ]);
  required(options, "--output");
  const ctx = await context(options);
  await backup(ctx, options["--output"]);
  console.log(
    "Database backup and checksum manifest saved with owner-only permissions. The encryption key is not included; preserve it separately.",
  );
});
