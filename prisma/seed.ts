import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { encrypt } from '../src/lib/crypto';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'admin123';

  const admin = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN', tier: 9 },
  });

  // A default access token for quick testing
  const raw = 'sk-' + randomBytes(24).toString('hex');
  await prisma.accessToken.create({
    data: {
      userId: admin.id,
      name: 'default',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      hint: raw.slice(-4),
    },
  });

  const tpl = await prisma.paramTemplate.upsert({
    where: { name: 'default-chat' },
    update: {},
    create: { name: 'default-chat', params: { temperature: 0.7, max_tokens: 2048, top_p: 1 } },
  });

  // Example channel (Ollama local, OpenAI-compatible)
  if (process.env.SEED_OLLAMA !== 'false') {
    const ch = await prisma.channel.upsert({
      where: { name: 'local-ollama' },
      update: {},
      create: {
        name: 'local-ollama',
        provider: 'OLLAMA',
        baseUrl: 'http://localhost:11434/v1',
        keys: { create: { encryptedKey: encrypt('ollama'), hint: 'lama' } },
      },
    });
    await prisma.modelMapping.upsert({
      where: { channelId_publicModel: { channelId: ch.id, publicModel: 'llama3' } },
      update: {},
      create: { channelId: ch.id, publicModel: 'llama3', upstreamModel: 'llama3:latest', paramTemplateId: tpl.id },
    });
  }

  console.log('Seed complete.');
  console.log(`Admin: ${username} / ${password}`);
  console.log(`Access token (save it, shown once): ${raw}`);
}

main().finally(() => prisma.$disconnect());
