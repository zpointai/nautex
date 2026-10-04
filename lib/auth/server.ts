import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import {
  getBetterAuthSecret,
  getTrustedOrigins,
  isLocalAuthMode,
  isMicrosoftAuthConfigured,
} from "@/lib/auth/config";

const microsoftConfigured = isMicrosoftAuthConfigured();
const localAuth = isLocalAuthMode();

export const auth = betterAuth({
  appName: "Nautex AI",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: getBetterAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL || "http://127.0.0.1:3002",
  trustedOrigins: getTrustedOrigins(),
  emailAndPassword: {
    enabled: localAuth,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  socialProviders: microsoftConfigured
    ? {
        microsoft: {
          clientId: process.env.MICROSOFT_CLIENT_ID!,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
          tenantId: process.env.MICROSOFT_TENANT_ID!,
          authority: "https://login.microsoftonline.com",
          prompt: "select_account",
          mapProfileToUser: () => ({ image: undefined }),
        },
      }
    : {},
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const defaultRole = await prisma.role.findUnique({ where: { code: "read-only" }, select: { id: true } });
          if (!defaultRole) throw new Error("RBAC default role is not available.");
          await prisma.userRoleAssignment.upsert({
            where: { userId_roleId: { userId: user.id, roleId: defaultRole.id } },
            update: {},
            create: { userId: user.id, roleId: defaultRole.id },
          });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
        },
      },
    },
  },
});
