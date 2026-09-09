import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const ConfigSchema = z.object({
    KANBOARD_URL: z.string().trim().min(1),
    KANBOARD_USERNAME: z.string().trim().min(1),
    KANBOARD_API_KEY: z.string().trim().min(1),
    WEB_USERNAME: z.string().trim().min(1).default("admin"),
    WEB_PASSWORD: z.string().trim().min(1).optional(),
    WEB_JWT_SECRET: z.string().trim().min(32).optional(),
    WEB_PORT: z.coerce.number().int().positive().default(3000),
});

export interface AppConfig {
    url: string;
    username: string;
    apiKey: string;
}

export interface WebConfig {
    username: string;
    password: string;
    jwtSecret: string;
    port: number;
}

export function loadConfig(): AppConfig {
    const parsed = loadEnvironment();

    return {
        url: parsed.KANBOARD_URL,
        username: parsed.KANBOARD_USERNAME,
        apiKey: parsed.KANBOARD_API_KEY,
    };
}

export function loadWebConfig(): WebConfig {
    const parsed = loadEnvironment();

    return {
        username: parsed.WEB_USERNAME,
        password: parsed.WEB_PASSWORD ?? parsed.KANBOARD_API_KEY,
        jwtSecret: parsed.WEB_JWT_SECRET ?? parsed.KANBOARD_API_KEY.padEnd(32, "."),
        port: parsed.WEB_PORT,
    };
}

function loadEnvironment(): z.infer<typeof ConfigSchema> {
    const result = loadDotenv({ quiet: true });
    const parsed = ConfigSchema.safeParse({ ...result.parsed, ...process.env });
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map(issue => issue.path.join("."))
            .filter(Boolean)
            .join(", ");

        throw new Error(`Missing or invalid .env settings: ${fields}`);
    }

    return parsed.data;
}
