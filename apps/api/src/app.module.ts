import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DriveConnector } from "./connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "./connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "./connectors/google-sheets/project-registry.connector";
import { IntakeService } from "./intake.service";
import { ShortFilmScriptProvider } from "./providers/short-film-script.provider";

@Module({
  controllers: [AppController],
  providers: [
    DriveConnector,
    CharacterLibraryConnector,
    ProjectRegistryConnector,
    ShortFilmScriptProvider,
    IntakeService,
  ],
})
export class AppModule {}
