import "dotenv/config";
import { env } from "./config/env";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { seedAdmin, seedDemoCustomer } from "./services/auth.service";
import { ensureSettings } from "./services/settings.service";

async function main() {
  await dbConnect();
  await seedAdmin();
  await seedDemoCustomer();
  await ensureSettings();

  const { server } = createApp();

  server.timeout = 10 * 60 * 1000;

  server.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });
}

main();
