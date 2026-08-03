import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DriveConnector } from "./connectors/google-drive/drive.connector";
import { IntakeService } from "./intake.service";

@Module({
  controllers: [AppController],
  providers: [DriveConnector, IntakeService],
})
export class AppModule {}
