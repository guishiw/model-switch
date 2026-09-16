-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'DISABLED', 'CIRCUIT_OPEN');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('system', 'user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUCCESS', 'FAILED', 'REJECTED_RATE_LIMIT', 'REJECTED_AUDIT', 'QUEUE_TIMEOUT');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "weight" INTEGER NOT NULL DEFAULT 10,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "rpmLimit" INTEGER NOT NULL DEFAULT 0,
    "tpmLimit" INTEGER NOT NULL DEFAULT 0,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 0,
    "extraHeaders" JSONB,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "rpmLimit" INTEGER NOT NULL DEFAULT 0,
    "tpmLimit" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelMapping" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "publicModel" TEXT NOT NULL,
    "upstreamModel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paramTemplateId" TEXT,
    "inputPricePerM" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "outputPricePerM" DECIMAL(12,6) NOT NULL DEFAULT 0,

    CONSTRAINT "ModelMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParamTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParamTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "tier" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "rpmLimit" INTEGER NOT NULL DEFAULT 0,
    "tpmLimit" INTEGER NOT NULL DEFAULT 0,
    "tokenQuota" BIGINT NOT NULL DEFAULT 0,
    "tokensUsed" BIGINT NOT NULL DEFAULT 0,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 0,
    "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "contextWindow" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "requestLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tokenId" TEXT,
    "channelId" TEXT,
    "apiKeyId" TEXT,
    "publicModel" TEXT NOT NULL,
    "upstreamModel" TEXT,
    "status" "RequestStatus" NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "stream" BOOLEAN NOT NULL DEFAULT false,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "queueWaitMs" INTEGER NOT NULL DEFAULT 0,
    "ttfbMs" INTEGER,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "errorMessage" TEXT,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageStatHourly" (
    "id" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "channelId" TEXT,
    "tokenId" TEXT,
    "publicModel" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" BIGINT NOT NULL DEFAULT 0,
    "completionTokens" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "latencyP50" INTEGER NOT NULL DEFAULT 0,
    "latencyP95" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageStatHourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditHit" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "matched" TEXT[],
    "snippet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_name_key" ON "Channel"("name");

-- CreateIndex
CREATE INDEX "Channel_status_idx" ON "Channel"("status");

-- CreateIndex
CREATE INDEX "ApiKey_channelId_enabled_idx" ON "ApiKey"("channelId", "enabled");

-- CreateIndex
CREATE INDEX "ModelMapping_publicModel_enabled_idx" ON "ModelMapping"("publicModel", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ModelMapping_channelId_publicModel_key" ON "ModelMapping"("channelId", "publicModel");

-- CreateIndex
CREATE UNIQUE INDEX "ParamTemplate_name_key" ON "ParamTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AccessToken_tokenHash_key" ON "AccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccessToken_userId_idx" ON "AccessToken"("userId");

-- CreateIndex
CREATE INDEX "ChatSession_userId_updatedAt_idx" ON "ChatSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestLog_requestId_key" ON "RequestLog"("requestId");

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_tokenId_createdAt_idx" ON "RequestLog"("tokenId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_channelId_createdAt_idx" ON "RequestLog"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_status_createdAt_idx" ON "RequestLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UsageStatHourly_bucket_idx" ON "UsageStatHourly"("bucket");

-- CreateIndex
CREATE UNIQUE INDEX "UsageStatHourly_bucket_channelId_tokenId_publicModel_key" ON "UsageStatHourly"("bucket", "channelId", "tokenId", "publicModel");

-- CreateIndex
CREATE INDEX "AuditHit_createdAt_idx" ON "AuditHit"("createdAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelMapping" ADD CONSTRAINT "ModelMapping_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelMapping" ADD CONSTRAINT "ModelMapping_paramTemplateId_fkey" FOREIGN KEY ("paramTemplateId") REFERENCES "ParamTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

