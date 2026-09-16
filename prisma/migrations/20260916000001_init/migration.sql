-- CreateTable
CREATE TABLE `Channel` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `provider` ENUM('OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA') NOT NULL,
    `baseUrl` VARCHAR(512) NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED', 'CIRCUIT_OPEN') NOT NULL DEFAULT 'ACTIVE',
    `weight` INTEGER NOT NULL DEFAULT 10,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `rpmLimit` INTEGER NOT NULL DEFAULT 0,
    `tpmLimit` INTEGER NOT NULL DEFAULT 0,
    `maxConcurrency` INTEGER NOT NULL DEFAULT 0,
    `extraHeaders` JSON NULL,
    `config` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Channel_name_key`(`name`),
    INDEX `Channel_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `encryptedKey` TEXT NOT NULL,
    `hint` VARCHAR(191) NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 10,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `disabledReason` VARCHAR(191) NULL,
    `rpmLimit` INTEGER NOT NULL DEFAULT 0,
    `tpmLimit` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApiKey_channelId_enabled_idx`(`channelId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelMapping` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `publicModel` VARCHAR(191) NOT NULL,
    `upstreamModel` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `paramTemplateId` VARCHAR(191) NULL,
    `inputPricePerM` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `outputPricePerM` DECIMAL(12, 6) NOT NULL DEFAULT 0,

    INDEX `ModelMapping_publicModel_enabled_idx`(`publicModel`, `enabled`),
    UNIQUE INDEX `ModelMapping_channelId_publicModel_key`(`channelId`, `publicModel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ParamTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `params` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ParamTemplate_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `tier` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccessToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `hint` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `rpmLimit` INTEGER NOT NULL DEFAULT 0,
    `tpmLimit` INTEGER NOT NULL DEFAULT 0,
    `tokenQuota` BIGINT NOT NULL DEFAULT 0,
    `tokensUsed` BIGINT NOT NULL DEFAULT 0,
    `maxConcurrency` INTEGER NOT NULL DEFAULT 0,
    `allowedModels` JSON NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AccessToken_tokenHash_key`(`tokenHash`),
    INDEX `AccessToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `model` VARCHAR(191) NOT NULL,
    `systemPrompt` TEXT NULL,
    `contextWindow` INTEGER NOT NULL DEFAULT 20,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatSession_userId_updatedAt_idx`(`userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `role` ENUM('system', 'user', 'assistant', 'tool') NOT NULL,
    `content` TEXT NOT NULL,
    `tokenCount` INTEGER NOT NULL DEFAULT 0,
    `requestLogId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatMessage_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestLog` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `apiKeyId` VARCHAR(191) NULL,
    `publicModel` VARCHAR(191) NOT NULL,
    `upstreamModel` VARCHAR(191) NULL,
    `status` ENUM('SUCCESS', 'FAILED', 'REJECTED_RATE_LIMIT', 'REJECTED_AUDIT', 'QUEUE_TIMEOUT') NOT NULL,
    `httpStatus` INTEGER NOT NULL,
    `stream` BOOLEAN NOT NULL DEFAULT false,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `completionTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `cost` DECIMAL(14, 8) NOT NULL DEFAULT 0,
    `latencyMs` INTEGER NOT NULL,
    `queueWaitMs` INTEGER NOT NULL DEFAULT 0,
    `ttfbMs` INTEGER NULL,
    `retries` INTEGER NOT NULL DEFAULT 0,
    `clientIp` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `errorMessage` TEXT NULL,
    `requestBody` JSON NULL,
    `responseBody` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RequestLog_requestId_key`(`requestId`),
    INDEX `RequestLog_createdAt_idx`(`createdAt`),
    INDEX `RequestLog_tokenId_createdAt_idx`(`tokenId`, `createdAt`),
    INDEX `RequestLog_channelId_createdAt_idx`(`channelId`, `createdAt`),
    INDEX `RequestLog_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageStatHourly` (
    `id` VARCHAR(191) NOT NULL,
    `bucket` DATETIME(3) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `tokenId` VARCHAR(191) NULL,
    `publicModel` VARCHAR(191) NOT NULL,
    `requests` INTEGER NOT NULL DEFAULT 0,
    `successes` INTEGER NOT NULL DEFAULT 0,
    `promptTokens` BIGINT NOT NULL DEFAULT 0,
    `completionTokens` BIGINT NOT NULL DEFAULT 0,
    `cost` DECIMAL(14, 8) NOT NULL DEFAULT 0,
    `latencyP50` INTEGER NOT NULL DEFAULT 0,
    `latencyP95` INTEGER NOT NULL DEFAULT 0,

    INDEX `UsageStatHourly_bucket_idx`(`bucket`),
    UNIQUE INDEX `UsageStatHourly_bucket_channelId_tokenId_publicModel_key`(`bucket`, `channelId`, `tokenId`, `publicModel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditHit` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `matched` JSON NOT NULL,
    `snippet` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditHit_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelMapping` ADD CONSTRAINT `ModelMapping_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelMapping` ADD CONSTRAINT `ModelMapping_paramTemplateId_fkey` FOREIGN KEY (`paramTemplateId`) REFERENCES `ParamTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessToken` ADD CONSTRAINT `AccessToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatSession` ADD CONSTRAINT `ChatSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChatSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestLog` ADD CONSTRAINT `RequestLog_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `AccessToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestLog` ADD CONSTRAINT `RequestLog_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

