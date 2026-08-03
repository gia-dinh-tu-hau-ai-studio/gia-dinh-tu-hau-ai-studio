import { Worker } from "bullmq";
import { normalizeProjectIntake } from "@tu-hau/contracts";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const queueName = process.env.AI_EXECUTOR_QUEUE ?? "ai-executor";

const worker = new Worker(
  queueName,
  async (job) => {
    switch (job.name) {
      case "VALIDATE_PROJECT_INTAKE":
        return {
          validation_status: "PASSED",
          contract: normalizeProjectIntake(job.data),
        };
      default:
        throw new Error(`Unsupported job: ${job.name}`);
    }
  },
  { connection },
);

worker.on("completed", (job) => {
  console.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id ?? "unknown"} failed`, error);
});

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
