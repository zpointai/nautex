import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Prisma, type UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROLE_CODES, type RoleCode } from "@/lib/auth/permissions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LocalUserInput {
  name: string;
  email: string;
  password: string;
  roleCode: RoleCode;
}

export function validateLocalUserInput(input: Partial<LocalUserInput>) {
  if (typeof input.name !== "string" || typeof input.email !== "string" || typeof input.password !== "string") throw new Error("Name must be provided with a valid email address and password.");
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const password = input.password ?? "";
  const roleCode = input.roleCode;
  if (name.length < 2 || name.length > 120) throw new Error("Name must contain between 2 and 120 characters.");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error("A valid email address is required.");
  if (password.length < 12 || password.length > 128) throw new Error("Password must contain between 12 and 128 characters.");
  if (!roleCode || !ROLE_CODES.includes(roleCode)) throw new Error("A valid Nautex role is required.");
  return { name, email, password, roleCode };
}

export async function prepareLocalCredential(input: Partial<LocalUserInput>) {
  const validated = validateLocalUserInput(input);
  return { ...validated, passwordHash: await hashPassword(validated.password) };
}

export async function hashLocalPassword(password: string) {
  if (password.length < 12 || password.length > 128) throw new Error("Password must contain between 12 and 128 characters.");
  return hashPassword(password);
}

export async function createLocalUser(
  tx: Prisma.TransactionClient,
  input: Awaited<ReturnType<typeof prepareLocalCredential>>,
) {
  const userId = randomUUID();
  const user = await tx.user.create({
    data: {
      id: userId,
      name: input.name,
      email: input.email,
      emailVerified: true,
      status: "Active",
    },
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: input.passwordHash,
    },
  });
  return user;
}

export async function getLocalBootstrapState() {
  const userCount = await prisma.user.count();
  return { required: userCount === 0, userCount };
}

export async function updateLocalPassword(userId: string, password: string) {
  const passwordHash = await hashLocalPassword(password);
  await prisma.$transaction([
    prisma.account.update({
      where: { providerId_accountId: { providerId: "credential", accountId: userId } },
      data: { password: passwordHash },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

export function isManagedUserStatus(value: unknown): value is Extract<UserStatus, "Active" | "Suspended" | "Disabled"> {
  return value === "Active" || value === "Suspended" || value === "Disabled";
}
