import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const ConfigSchema = z.object({
    KANBOARD_URL: z.string().trim().min(1),
    KANBOARD_USERNAME: z.string().trim().min(1),
    KANBOARD_API_KEY: z.string().trim().min(1),
});

export interface AppConfig {
    url: string;
    username: string;
    apiKey: string;
}

export function loadConfig(): AppConfig {
    const result = loadDotenv({ quiet: true });

    if (result.error) {
        throw new Error(
            `Could not load .env: ${result.error.message}. Copy .env.example to .env and fill in your Kanboard credentials.`,
        );
    }

    const parsed = ConfigSchema.safeParse(result.parsed);
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map(issue => issue.path.join("."))
            .filter(Boolean)
            .join(", ");

        throw new Error(`Missing or invalid .env settings: ${fields}`);
    }

    return {
        url: parsed.data.KANBOARD_URL,
        username: parsed.data.KANBOARD_USERNAME,
        apiKey: parsed.data.KANBOARD_API_KEY,
    };
}
