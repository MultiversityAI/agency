/**
 * Seed Script
 *
 * Bootstraps the context graph with initial math/science concept entities
 * and sample trajectories to enable structural embeddings from the start.
 *
 * Run with: bunx tsx src/seed.ts
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './db/schema';

const DATABASE_URL = process.env.API_DATABASE_URL ?? 'file:./api.db';
const DATABASE_AUTH_TOKEN = process.env.API_DATABASE_AUTH_TOKEN;

const client = createClient({
  url: DATABASE_URL,
  authToken: DATABASE_AUTH_TOKEN,
});

const db = drizzle(client, { schema });

// Demo user account for seeded data
const DEMO_ACCOUNT = 'demo.near';

// Math concept entities to seed
const CONCEPTS = [
  // Calculus fundamentals
  { name: 'limits', type: 'concept', description: 'The value a function approaches as input approaches a value' },
  { name: 'continuity', type: 'concept', description: 'A function with no breaks, jumps, or holes' },
  { name: 'derivatives', type: 'concept', description: 'The rate of change of a function' },
  { name: 'integrals', type: 'concept', description: 'The accumulation of quantities over an interval' },

  // Derivative rules
  { name: 'power rule', type: 'rule', description: 'd/dx(x^n) = nx^(n-1)' },
  { name: 'product rule', type: 'rule', description: 'd/dx(fg) = f\'g + fg\'' },
  { name: 'quotient rule', type: 'rule', description: 'd/dx(f/g) = (f\'g - fg\')/g²' },
  { name: 'chain rule', type: 'rule', description: 'd/dx(f(g(x))) = f\'(g(x))·g\'(x)' },

  // Integration techniques
  { name: 'antiderivative', type: 'concept', description: 'The reverse of differentiation' },
  { name: 'integration by parts', type: 'technique', description: '∫udv = uv - ∫vdu' },
  { name: 'u-substitution', type: 'technique', description: 'Change of variables in integration' },
  { name: 'fundamental theorem', type: 'theorem', description: 'Links differentiation and integration' },

  // Algebra
  { name: 'functions', type: 'concept', description: 'Relations mapping inputs to outputs' },
  { name: 'polynomials', type: 'concept', description: 'Expressions with variables and coefficients' },
  { name: 'quadratic equations', type: 'concept', description: 'Equations of the form ax² + bx + c = 0' },
  { name: 'linear equations', type: 'concept', description: 'Equations forming straight lines' },

  // Trigonometry
  { name: 'sine', type: 'function', description: 'Opposite over hypotenuse' },
  { name: 'cosine', type: 'function', description: 'Adjacent over hypotenuse' },
  { name: 'tangent', type: 'function', description: 'Opposite over adjacent' },

  // Applications
  { name: 'rate of change', type: 'application', description: 'How fast a quantity changes' },
  { name: 'area under curve', type: 'application', description: 'Definite integral interpretation' },
  { name: 'slope', type: 'application', description: 'Steepness of a line or curve' },
];

// Sample trajectories representing common learning paths
const TRAJECTORIES = [
  {
    input: 'What is a derivative?',
    concepts: ['derivatives', 'rate of change', 'limits', 'slope'],
    summary: 'Explained derivatives as rate of change',
  },
  {
    input: 'How do I find the derivative of x squared?',
    concepts: ['derivatives', 'power rule'],
    summary: 'Applied power rule to x²',
  },
  {
    input: 'Explain the chain rule',
    concepts: ['derivatives', 'chain rule', 'functions'],
    summary: 'Explained chain rule for composite functions',
  },
  {
    input: 'What is integration?',
    concepts: ['integrals', 'antiderivative', 'area under curve', 'fundamental theorem'],
    summary: 'Introduced integration as reverse of differentiation',
  },
  {
    input: 'How do I integrate x squared?',
    concepts: ['integrals', 'antiderivative', 'power rule'],
    summary: 'Applied power rule in reverse for integration',
  },
  {
    input: 'What are limits?',
    concepts: ['limits', 'continuity', 'functions'],
    summary: 'Explained limits as foundation for calculus',
  },
  {
    input: 'Explain sine and cosine',
    concepts: ['sine', 'cosine', 'tangent'],
    summary: 'Introduced basic trigonometric functions',
  },
  {
    input: 'What is the product rule?',
    concepts: ['derivatives', 'product rule', 'chain rule'],
    summary: 'Explained product rule for derivatives',
  },
];

async function seed() {
  console.log('Seeding database...\n');

  const now = new Date();

  // 1. Create entities
  console.log('Creating concept entities...');
  const entityIds = new Map<string, string>();

  for (const concept of CONCEPTS) {
    const id = nanoid();
    entityIds.set(concept.name, id);

    await db.insert(schema.entity).values({
      id,
      name: concept.name,
      normalizedName: concept.name.toLowerCase().trim(),
      entityType: concept.type,
      description: concept.description,
      touchCount: 0,
      trajectoryCount: 0,
      contributorCount: 0,
      firstSeen: now,
      lastSeen: now,
    }).onConflictDoNothing();

    console.log(`  + ${concept.name} (${concept.type})`);
  }

  // 2. Create a demo conversation
  console.log('\nCreating demo conversation...');
  const conversationId = nanoid();
  await db.insert(schema.conversation).values({
    id: conversationId,
    nearAccountId: DEMO_ACCOUNT,
    title: 'Learning Calculus',
    createdAt: now,
    updatedAt: now,
  });

  // 3. Create sample trajectories with events
  console.log('Creating sample trajectories...\n');

  for (let i = 0; i < TRAJECTORIES.length; i++) {
    const traj = TRAJECTORIES[i];
    if (!traj) continue;

    const trajectoryId = nanoid();
    const startedAt = new Date(now.getTime() - (TRAJECTORIES.length - i) * 60000); // Stagger times

    await db.insert(schema.trajectory).values({
      id: trajectoryId,
      nearAccountId: DEMO_ACCOUNT,
      conversationId,
      inputText: traj.input,
      inputHash: traj.input.slice(0, 8),
      summary: traj.summary,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 5000),
    });

    console.log(`Trajectory: "${traj.input}"`);

    // Create events for each concept touched
    for (let j = 0; j < traj.concepts.length; j++) {
      const conceptName = traj.concepts[j];
      if (!conceptName) continue;

      const entityId = entityIds.get(conceptName);
      if (!entityId) continue;

      // Log touch event
      await db.insert(schema.event).values({
        id: nanoid(),
        trajectoryId,
        sequenceNum: j,
        timestamp: new Date(startedAt.getTime() + j * 1000),
        eventType: j === traj.concepts.length - 1 ? 'discover' : 'touch',
        entityId,
        data: JSON.stringify({ source: 'seed', concept: conceptName }),
      });

      // Update touch count
      const [entity] = await db
        .select()
        .from(schema.entity)
        .where(eq(schema.entity.id, entityId))
        .limit(1);

      if (entity) {
        await db
          .update(schema.entity)
          .set({
            touchCount: entity.touchCount + 1,
            lastSeen: startedAt,
          })
          .where(eq(schema.entity.id, entityId));
      }

      console.log(`  → ${conceptName}`);
    }

    // Create edges between consecutive concepts
    for (let j = 0; j < traj.concepts.length - 1; j++) {
      const sourceName = traj.concepts[j];
      const targetName = traj.concepts[j + 1];
      if (!sourceName || !targetName) continue;

      const sourceId = entityIds.get(sourceName);
      const targetId = entityIds.get(targetName);
      if (!sourceId || !targetId) continue;

      const edgeId = `${sourceId}:${targetId}`;

      const [existingEdge] = await db
        .select()
        .from(schema.edge)
        .where(eq(schema.edge.id, edgeId))
        .limit(1);

      if (existingEdge) {
        await db
          .update(schema.edge)
          .set({
            weight: existingEdge.weight + 1,
            trajectoryCount: existingEdge.trajectoryCount + 1,
            lastSeen: startedAt,
          })
          .where(eq(schema.edge.id, edgeId));
      } else {
        await db.insert(schema.edge).values({
          id: edgeId,
          sourceEntityId: sourceId,
          targetEntityId: targetId,
          weight: 1,
          trajectoryCount: 1,
          firstSeen: startedAt,
          lastSeen: startedAt,
        });
      }
    }

    // Create cooccurrences between all concepts in trajectory
    for (let j = 0; j < traj.concepts.length; j++) {
      for (let k = j + 1; k < traj.concepts.length; k++) {
        const nameA = traj.concepts[j];
        const nameB = traj.concepts[k];
        if (!nameA || !nameB) continue;

        const idA = entityIds.get(nameA);
        const idB = entityIds.get(nameB);
        if (!idA || !idB) continue;

        const sorted = [idA, idB].sort();
        const coocId = `${sorted[0]}:${sorted[1]}`;

        const [existingCooc] = await db
          .select()
          .from(schema.cooccurrence)
          .where(eq(schema.cooccurrence.id, coocId))
          .limit(1);

        if (existingCooc) {
          await db
            .update(schema.cooccurrence)
            .set({
              count: existingCooc.count + 1,
              windowCount: existingCooc.windowCount + 1,
              lastUpdated: startedAt,
            })
            .where(eq(schema.cooccurrence.id, coocId));
        } else {
          await db.insert(schema.cooccurrence).values({
            id: coocId,
            entityA: sorted[0]!,
            entityB: sorted[1]!,
            count: 1,
            windowCount: 1,
            lastUpdated: startedAt,
          });
        }
      }
    }

    console.log('');
  }

  console.log('Seed complete!');
  console.log(`\nCreated:`);
  console.log(`  - ${CONCEPTS.length} concept entities`);
  console.log(`  - ${TRAJECTORIES.length} sample trajectories`);
  console.log(`  - 1 demo conversation`);
  console.log(`\nYou can now chat with the Teacher Assistant to see the context graph in action.`);

  process.exit(0);
}

seed().catch(console.error);
