import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DriveConnector } from "./connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "./connectors/google-sheets/character-library.connector";
import { AiMusicFactoryConnector } from "./connectors/n8n/ai-music-factory.connector";
import { IntakeService } from "./intake.service";

@Module({
  controllers: [AppController],
  providers: [
    DriveConnector,
    CharacterLibraryConnector,
    AiMusicFactoryConnector,
    IntakeService,
  ],
})
export class AppModule {}
