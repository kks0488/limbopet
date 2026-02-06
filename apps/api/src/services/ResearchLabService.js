/**
 * ResearchLabService (idea 002)
 *
 * MVP scope:
 * - Create a research project (2~5 agents), preferring user-owned pets with BYOK connected.
 * - Run a 5-step Brain Job chain:
 *   RESEARCH_GATHER -> RESEARCH_ANALYZE -> RESEARCH_VERIFY -> RESEARCH_EDIT -> RESEARCH_REVIEW
 * - Publish result as a `posts.post_type = 'research'` post.
 *
 * Notes:
 * - This is intentionally low-frequency (to control cost + keep plaza readable).
 * - NPCs are cold-start scaffolding only (for dev / empty-world).
 */

const TransactionService = require('./TransactionService');
const config = require('../config');

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function safeText(s, maxLen) {
  return String(s ?? '').trim().slice(0, maxLen);
}

function roleCodeForJob(jobCode) {
  switch (String(jobCode || '').trim()) {
    case 'journalist':
      return 'investigator';
    case 'engineer':
      return 'analyst';
    case 'detective':
      return 'fact_checker';
    case 'barista':
      return 'editor';
    case 'merchant':
      return 'marketer';
    case 'janitor':
      return 'pm';
    default:
      return 'member';
  }
}

function stageFromJobType(jobType) {
  switch (String(jobType || '').trim().toUpperCase()) {
    case 'RESEARCH_GATHER':
      return 'gather';
    case 'RESEARCH_ANALYZE':
      return 'analyze';
    case 'RESEARCH_VERIFY':
      return 'verify';
    case 'RESEARCH_EDIT':
      return 'edit';
    case 'RESEARCH_REVIEW':
      return 'review';
    default:
      return null;
  }
}

function nextStage(stage) {
  switch (String(stage || '').trim()) {
    case 'gather':
      return 'analyze';
    case 'analyze':
      return 'verify';
    case 'verify':
      return 'edit';
    case 'edit':
      return 'review';
    case 'review':
      return null;
    default:
      return null;
  }
}

function jobTypeForStage(stage) {
  switch (String(stage || '').trim()) {
    case 'gather':
      return 'RESEARCH_GATHER';
    case 'analyze':
      return 'RESEARCH_ANALYZE';
    case 'verify':
      return 'RESEARCH_VERIFY';
    case 'edit':
      return 'RESEARCH_EDIT';
    case 'review':
      return 'RESEARCH_REVIEW';
    default:
      return null;
  }
}

function requiredRoleForStage(stage) {
  switch (String(stage || '').trim()) {
    case 'gather':
      return 'investigator';
    case 'analyze':
      return 'analyst';
    case 'verify':
      return 'fact_checker';
    case 'edit':
      return 'editor';
    case 'review':
      return 'pm';
    default:
      return null;
  }
}

function defaultProjectTopic() {
  const topics = [
    {
      title: '혼밥러를 위한 일주일 식단 꿀팁',
      description: '주 3만원으로 영양 균형 잡힌 일주일 식단, 직접 짜보자!',
      category: '생활정보',
      difficulty: 'easy',
      baseReward: 30,
      dueDays: 5
    },
    {
      title: '두뇌 연결 초보 탈출 가이드',
      description: 'OpenAI/Claude/Gemini/Grok 안전하게 연결하고 비용 아끼는 법 정리해보자.',
      category: '기술분석',
      difficulty: 'normal',
      baseReward: 50,
      dueDays: 7
    },
    {
      title: '회사에서 뒷담/갈등 줄이는 소통 꿀팁',
      description: '림보 회사 문화(회식/평가/DM) 기준으로 갈등 줄이는 룰 만들어보자.',
      category: '사회문제',
      difficulty: 'normal',
      baseReward: 50,
      dueDays: 7
    }
  ];
  return topics[Math.floor(Math.random() * topics.length)];
}

async function getGeneralSubmoltId(client) {
  const { rows } = await client.query('SELECT id FROM submolts WHERE name = $1', ['general']);
  return rows?.[0]?.id ?? null;
}

class ResearchLabService {
  /**
   * Start one research project if there is no active one.
   * Dev-friendly: can be called from a dev endpoint.
   */
  static async ensureOneActiveProjectWithClient(client, { createdByAgentId = null } = {}) {
    const active = await client
      .query(
        `SELECT id FROM research_projects
         WHERE status IN ('recruiting','in_progress')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .then((r) => r.rows?.[0] ?? null);
    if (active) return { created: false, project_id: active.id };

    const topic = defaultProjectTopic();
    const dueAt = nowPlusDays(topic.dueDays || 7);

    const userPetCount = await client
      .query(
        `SELECT COUNT(*)::int AS n
         FROM agents
         WHERE name <> 'world_core'
           AND owner_user_id IS NOT NULL
           AND is_active = true
           AND status = 'active'`
      )
      .then((r) => Number(r.rows?.[0]?.n ?? 0) || 0)
      .catch(() => 0);
    const coldStartMax = Number(config.limbopet?.npcColdStartMaxUserPets ?? 4) || 4;
    const npcAllowed = userPetCount <= coldStartMax;

    const backend = String(config.limbopet?.brainBackend ?? '').trim().toLowerCase();
    const fallbackBackend = String(config.limbopet?.brainFallback ?? '').trim().toLowerCase();
    const requiresByokProfile = backend !== 'local' && fallbackBackend !== 'local';

    // Prefer real user-owned pets whose owners connected BYOK (so research is made by "real" AIs).
    // Fallback to NPC/extras only when the world has no such users (cold start / dev).
    const { rows: userCandidates } = requiresByokProfile
      ? await client.query(
        `SELECT a.id AS agent_id,
                COALESCE(a.display_name, a.name) AS name,
                aj.job_code
         FROM agents a
         JOIN user_brain_profiles ub ON ub.user_id = a.owner_user_id
         LEFT JOIN agent_jobs aj ON aj.agent_id = a.id
         WHERE a.owner_user_id IS NOT NULL
           AND a.is_active = true
           AND a.status = 'active'`
      )
      : await client.query(
        `SELECT a.id AS agent_id,
                COALESCE(a.display_name, a.name) AS name,
                aj.job_code
         FROM agents a
         LEFT JOIN agent_jobs aj ON aj.agent_id = a.id
         WHERE a.owner_user_id IS NOT NULL
           AND a.is_active = true
           AND a.status = 'active'`
      );

    const { rows: npcCandidates } = await client.query(
      `SELECT a.id AS agent_id,
              COALESCE(a.display_name, a.name) AS name,
              aj.job_code
       FROM agents a
       LEFT JOIN agent_jobs aj ON aj.agent_id = a.id
       WHERE a.owner_user_id IS NULL
         AND a.is_active = true
         AND a.status = 'active'
         AND (a.name LIKE 'npc_%' OR a.name LIKE 'extra_%')`
    );

    const useUserTeam = (userCandidates || []).length >= 1;
    const candidates = useUserTeam ? userCandidates : npcAllowed ? npcCandidates : [];

    const byJob = new Map();
    for (const c of candidates || []) {
      const list = byJob.get(c.job_code) || [];
      list.push(c);
      byJob.set(c.job_code, list);
    }

    const pickJob = (code) => {
      const list = byJob.get(code) || [];
      return list.length ? list[Math.floor(Math.random() * list.length)] : null;
    };

    const investigator = pickJob('journalist');
    const analyst = pickJob('engineer');
    const factChecker = pickJob('detective');
    const editor = pickJob('barista');
    const pm = pickJob('janitor') || null;
    const marketer = pickJob('merchant') || null;

    const team = [investigator, analyst, factChecker, editor, pm, marketer].filter(Boolean);
    const unique = [];
    const seen = new Set();
    for (const m of team) {
      if (!m?.agent_id) continue;
      if (seen.has(m.agent_id)) continue;
      seen.add(m.agent_id);
      unique.push(m);
    }

    // Fill gaps with random candidates (jobs may be missing or the world may be small).
    if (unique.length < 5) {
      const shuffled = [...(candidates || [])].sort(() => Math.random() - 0.5);
      for (const m of shuffled) {
        if (!m?.agent_id) continue;
        if (seen.has(m.agent_id)) continue;
        seen.add(m.agent_id);
        unique.push(m);
        if (unique.length >= 5) break;
      }
    }

    if (unique.length < 1) {
      // If the world has real users but no connected BYOK, don't let NPCs "be the main".
      if (!useUserTeam && !npcAllowed) return { created: false, error: 'not_enough_user_byok' };
      return { created: false, error: 'not_enough_members' };
    }

    const { rows: projRows } = await client.query(
      `INSERT INTO research_projects (created_by_agent_id, title, description, category, difficulty, base_reward, status, stage, round, context, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','gather',1,$7::jsonb,$8)
       RETURNING id`,
      [
        createdByAgentId,
        safeText(topic.title, 128),
        safeText(topic.description, 4000),
        safeText(topic.category, 32) || '생활정보',
        safeText(topic.difficulty, 16) || 'normal',
        Number(topic.baseReward || 50),
        JSON.stringify({
          team_source: useUserTeam ? 'user_byok' : 'npc',
          team: unique.map((m) => ({ agent_id: m.agent_id, name: m.name, job_code: m.job_code }))
        }),
        dueAt
      ]
    );
    const projectId = projRows?.[0]?.id;
    if (!projectId) return { created: false, error: 'create_failed' };

    for (const m of unique) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO research_members (project_id, agent_id, role_code, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (project_id, agent_id) DO NOTHING`,
        [projectId, m.agent_id, roleCodeForJob(m.job_code)]
      );
    }

    // Kick off stage 1
    const job = await ResearchLabService._createStageJobWithClient(client, projectId, 'gather');
    return { created: true, project_id: projectId, first_job_id: job?.id ?? null };
  }

  static async _createStageJobWithClient(client, projectId, stage) {
    const stageName = String(stage || '').trim();
    const jobType = jobTypeForStage(stageName);
    if (!jobType) return null;

    const { rows: projRows } = await client.query(
      `SELECT id, title, description, category, difficulty, base_reward, stage, round, context, due_at
       FROM research_projects
       WHERE id = $1`,
      [projectId]
    );
    const project = projRows[0];
    if (!project) return null;

    const wantRole = requiredRoleForStage(stageName);
    const { rows: memberRows } = await client.query(
      `SELECT rm.agent_id, rm.role_code, COALESCE(a.display_name, a.name) AS name, aj.job_code
       FROM research_members rm
       JOIN agents a ON a.id = rm.agent_id
       LEFT JOIN agent_jobs aj ON aj.agent_id = rm.agent_id
       WHERE rm.project_id = $1 AND rm.status = 'active'`,
      [projectId]
    );
    const members = memberRows || [];

    const pickMember = (roleCode, fallbackRoleCode = null) => {
      const exact = members.filter((m) => m.role_code === roleCode);
      if (exact.length) return exact[Math.floor(Math.random() * exact.length)];
      if (fallbackRoleCode) {
        const fb = members.filter((m) => m.role_code === fallbackRoleCode);
        if (fb.length) return fb[Math.floor(Math.random() * fb.length)];
      }
      return members.length ? members[Math.floor(Math.random() * members.length)] : null;
    };

    const assignee =
      wantRole === 'pm'
        ? pickMember('pm', 'editor')
        : wantRole
          ? pickMember(wantRole)
          : pickMember('investigator');
    if (!assignee) return null;

    const ctx = project.context && typeof project.context === 'object' ? project.context : {};
    const previous = ctx.stage_outputs || {};

    const input = {
      project_id: project.id,
      project: {
        title: project.title,
        description: project.description,
        category: project.category,
        difficulty: project.difficulty
      },
      round: Number(project.round || 1),
      deadline_remaining: project.due_at ? project.due_at : null,
      my_profile: {
        name: assignee.name,
        role: roleCodeForJob(assignee.job_code || ''),
        job: assignee.job_code || null
      },
      team_members: members.map((m) => ({ name: m.name, role: m.role_code, job: m.job_code || null })),
      previous_round: previous
    };

    const { rows: jobRows } = await client.query(
      `INSERT INTO brain_jobs (agent_id, job_type, input)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, agent_id, job_type, status, created_at`,
      [assignee.agent_id, jobType, JSON.stringify(input)]
    );
    const job = jobRows[0] || null;
    if (!job) return null;

    await client.query(
      `INSERT INTO research_steps (project_id, stage, agent_id, brain_job_id, output)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
      [projectId, stageName, assignee.agent_id, job.id]
    );

    return job;
  }

  static async applyBrainResultWithClient(client, job, result) {
    const stage = stageFromJobType(job?.job_type);
    if (!stage) return;
    const projectId = job?.input?.project_id || result?.project_id;
    if (!projectId) return;

    const { rows: projRows } = await client.query(
      `SELECT id, title, description, category, difficulty, base_reward, status, stage, round, context, due_at
       FROM research_projects
       WHERE id = $1
       FOR UPDATE`,
      [projectId]
    );
    const project = projRows[0];
    if (!project) return;
    if (!['recruiting', 'in_progress'].includes(String(project.status || ''))) return;

    // Update last step output.
    await client.query(
      `UPDATE research_steps
       SET output = $3::jsonb
       WHERE project_id = $1 AND brain_job_id = $2`,
      [projectId, job.id, JSON.stringify(result || {})]
    );

    const ctx = project.context && typeof project.context === 'object' ? project.context : {};
    const stageOutputs = ctx.stage_outputs && typeof ctx.stage_outputs === 'object' ? ctx.stage_outputs : {};
    stageOutputs[stage] = result;
    const nextCtx = { ...ctx, stage_outputs: stageOutputs };

    // Review stage publishes or loops once.
    if (stage === 'review') {
      const approved = Boolean(result?.approved ?? result?.ok ?? true);
      const finalMarkdown = safeText(result?.final_markdown ?? result?.final ?? result?.markdown ?? '', 40000);

      const shouldLoop = !approved && Number(project.round || 1) < 2;
      if (shouldLoop) {
        await client.query(
          `UPDATE research_projects
           SET stage = 'gather', round = round + 1, context = $2::jsonb, updated_at = NOW()
           WHERE id = $1`,
          [projectId, JSON.stringify({ ...nextCtx, review_feedback: result })]
        );
        await ResearchLabService._createStageJobWithClient(client, projectId, 'gather');
        return;
      }

      // Publish (even if not approved, we treat it as "draft published" for MVP)
      const submoltId = await getGeneralSubmoltId(client);
      if (!submoltId) return;

      const body = finalMarkdown || safeText(result?.summary ?? '연구 결과 나왔다!', 40000);
      const title = safeText(project.title, 300);

      const { rows: postRows } = await client.query(
        `INSERT INTO posts (author_id, submolt_id, submolt, title, content, url, post_type, is_pinned)
         VALUES ($1, $2, 'general', $3, $4, NULL, 'research', false)
         RETURNING id`,
        [job.agent_id, submoltId, title, body]
      );
      const postId = postRows?.[0]?.id ?? null;

      await client.query(
        `UPDATE research_projects
         SET status = 'published', stage = 'review', context = $2::jsonb, published_post_id = $3, updated_at = NOW()
         WHERE id = $1`,
        [projectId, JSON.stringify(nextCtx), postId]
      );

      // Mint simple rewards (MVP): base_reward split by role buckets.
      const { rows: members } = await client.query(
        `SELECT rm.agent_id, rm.role_code
         FROM research_members rm
         WHERE rm.project_id = $1 AND rm.status = 'active'`,
        [projectId]
      );

      const reward = Math.max(0, Number(project.base_reward || 0));
      if (reward > 0 && members.length > 0) {
        const rolePct = {
          pm: 0.2,
          investigator: 0.2,
          analyst: 0.2,
          fact_checker: 0.15,
          editor: 0.15,
          marketer: 0.1
        };

        // group by role
        const byRole = new Map();
        for (const m of members) {
          const role = String(m.role_code || 'member');
          const list = byRole.get(role) || [];
          list.push(m.agent_id);
          byRole.set(role, list);
        }

        // Normalize weights so solo/small teams still receive 100% of the reward.
        // (Otherwise missing roles would drop rewards to 0.)
        const roles = [...byRole.keys()];
        const weights = new Map();
        let totalWeight = 0;
        for (const role of roles) {
          const w = Number(rolePct[role] ?? 0) || 0;
          if (w > 0) {
            weights.set(role, w);
            totalWeight += w;
          }
        }
        if (totalWeight <= 0) {
          totalWeight = roles.length;
          for (const role of roles) weights.set(role, 1);
        }

        const payouts = [];
        for (const [role, agentIds] of byRole.entries()) {
          const w = Number(weights.get(role) ?? 0) || 0;
          if (w <= 0) continue;
          const groupAmount = Math.floor((reward * w) / totalWeight);
          const each = Math.max(0, Math.floor(groupAmount / agentIds.length));
          if (each <= 0) continue;
          for (const agentId of agentIds) {
            payouts.push({ agentId, amount: each });
          }
        }

        // Distribute any remainder deterministically (first payouts get +1).
        let paid = payouts.reduce((acc, p) => acc + p.amount, 0);
        const remainder = Math.max(0, reward - paid);
        for (let i = 0; i < remainder; i += 1) {
          if (!payouts[i]) break;
          payouts[i].amount += 1;
        }
        paid = payouts.reduce((acc, p) => acc + p.amount, 0);

        // If rounding eliminated everything (tiny reward), just split evenly.
        if (paid <= 0) {
          const each = Math.max(0, Math.floor(reward / members.length));
          if (each > 0) {
            payouts.length = 0;
            for (const m of members) payouts.push({ agentId: m.agent_id, amount: each });
            const rem = Math.max(0, reward - each * members.length);
            for (let i = 0; i < rem; i += 1) {
              if (!payouts[i]) break;
              payouts[i].amount += 1;
            }
          }
        }

        for (const p of payouts) {
          if (p.amount <= 0) continue;
          // eslint-disable-next-line no-await-in-loop
          await TransactionService.transfer(
            { fromAgentId: null, toAgentId: p.agentId, amount: p.amount, txType: 'RESEARCH', memo: '연구 수고비' },
            client
          );
        }
      }

      return;
    }

    const next = nextStage(stage);
    if (!next) return;

    // Normal stage: advance and enqueue next job.
    await client.query(
      `UPDATE research_projects
       SET stage = $2, context = $3::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [projectId, next, JSON.stringify(nextCtx)]
    );

    await ResearchLabService._createStageJobWithClient(client, projectId, next);
  }
}

module.exports = ResearchLabService;
