export function getShortFilmProviderStatus(environment: NodeJS.ProcessEnv) {
  return {
    secret_values_exposed: false as const,
    providers: {
      script: { provider: "OPENAI_RESPONSES" as const, configured: Boolean(environment.OPENAI_API_KEY?.trim()) },
      image_to_video: { provider: "RUNWAY_IMAGE_TO_VIDEO" as const, configured: Boolean(environment.RUNWAYML_API_SECRET?.trim()) },
      lip_sync: { provider: "SYNC_LIP_SYNC" as const, configured: Boolean(environment.SYNC_API_KEY?.trim()) },
      voice: { provider: "APPROVED_VOICE_MASTER" as const, configured: true },
    },
  };
}
