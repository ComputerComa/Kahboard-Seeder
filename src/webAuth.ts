import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { WebConfig } from "./config.js";

const COOKIE_NAME = "kanseed_session";
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

export function requireAuth(config: WebConfig) {
    return (request: Request, response: Response, next: NextFunction): void => {
        if (request.path === "/login" || request.path.startsWith("/assets/")) {
            next();
            return;
        }

        if (isValidBasicAuth(request, config) || isValidCookie(request, config)) {
            next();
            return;
        }

        response.redirect("/login");
    };
}

export function login(response: Response, config: WebConfig): void {
    response.cookie(COOKIE_NAME, signToken(config), {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: TOKEN_TTL_SECONDS * 1000,
    });
}

export function logout(response: Response): void {
    response.clearCookie(COOKIE_NAME);
}

export function credentialsMatch(username: string, password: string, config: WebConfig): boolean {
    return safeEqual(username, config.username) && safeEqual(password, config.password);
}

function isValidBasicAuth(request: Request, config: WebConfig): boolean {
    const header = request.header("authorization");
    if (!header?.startsWith("Basic ")) return false;

    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return false;

    return credentialsMatch(decoded.slice(0, separator), decoded.slice(separator + 1), config);
}

function isValidCookie(request: Request, config: WebConfig): boolean {
    const token = parseCookies(request.header("cookie") ?? "")[COOKIE_NAME];
    if (!token) return false;

    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;

    const expectedSignature = hmac(payload, config.jwtSecret);
    if (!safeEqual(signature, expectedSignature)) return false;

    let decoded: TokenPayload;
    try {
        decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    } catch {
        return false;
    }

    return decoded.sub === config.username && decoded.exp > Math.floor(Date.now() / 1000);
}

function signToken(config: WebConfig): string {
    const payload = Buffer.from(JSON.stringify({
        sub: config.username,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    })).toString("base64url");

    return `${payload}.${hmac(payload, config.jwtSecret)}`;
}

function hmac(value: string, secret: string): string {
    return createHmac("sha256", secret).update(value).digest("base64url");
}

function parseCookies(header: string): Record<string, string> {
    return Object.fromEntries(header
        .split(";")
        .map(cookie => cookie.trim())
        .filter(Boolean)
        .map(cookie => {
            const separator = cookie.indexOf("=");
            return separator === -1
                ? [cookie, ""]
                : [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
        }));
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

interface TokenPayload {
    sub: string;
    exp: number;
}
