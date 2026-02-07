const { queryOne, transaction } = require('../config/database');
const { BadRequestError } = require('../utils/errors');

function safeText(v, maxLen) {
  return String(v ?? '').trim().slice(0, maxLen);
}

function publicView(row) {
  if (!row) {
    return {
      enabled: false,
      prompt_text: '',
      version: 0,
      updated_at: null,
      connected: false
    };
  }

  return {
    enabled: Boolean(row.enabled),
    prompt_text: String(row.prompt_text ?? ''),
    version: Math.max(0, Math.trunc(Number(row.version ?? 0) || 0)),
    updated_at: row.updated_at ?? null,
    connected: true
  };
}

class UserPromptProfileService {
  static async get(userId, client = null) {
    const sql = `SELECT user_id, enabled, prompt_text, version, updated_at
                 FROM user_prompt_profiles
                 WHERE user_id = $1`;

    const row = client
      ? await client.query(sql, [userId]).then((r) => r.rows?.[0] ?? null)
      : await queryOne(sql, [userId]);

    return publicView(row);
  }

  static async upsert(userId, { enabled, promptText }) {
    const safeEnabled = Boolean(enabled);
    const safePrompt = safeText(promptText, 8000);

    if (safeEnabled && !safePrompt) {
      throw new BadRequestError('prompt_text is required when enabled is true', 'PROMPT_TEXT_REQUIRED');
    }

    return transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO user_prompt_profiles (user_id, enabled, prompt_text, version, created_at, updated_at)
         VALUES ($1, $2, $3, 1, NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           enabled = EXCLUDED.enabled,
           prompt_text = EXCLUDED.prompt_text,
           version = CASE
             WHEN user_prompt_profiles.prompt_text IS DISTINCT FROM EXCLUDED.prompt_text
                  OR user_prompt_profiles.enabled IS DISTINCT FROM EXCLUDED.enabled
               THEN user_prompt_profiles.version + 1
             ELSE user_prompt_profiles.version
           END,
           updated_at = NOW()
         RETURNING user_id, enabled, prompt_text, version, updated_at`,
        [userId, safeEnabled, safePrompt]
      );

      return publicView(rows[0]);
    });
  }

  static async delete(userId) {
    return transaction(async (client) => {
      await client.query('DELETE FROM user_prompt_profiles WHERE user_id = $1', [userId]);
      return true;
    });
  }
}

module.exports = UserPromptProfileService;
