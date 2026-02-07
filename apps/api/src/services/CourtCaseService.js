const { queryOne, queryAll } = require('../config/database');

class CourtCaseService {
  static async getRandomCase(options = {}) {
    const { category, difficulty } = options;
    let query = 'SELECT * FROM court_cases WHERE 1=1';
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (difficulty != null) {
      params.push(Number(difficulty) || 0);
      query += ` AND difficulty = $${params.length}`;
    }

    query += ' ORDER BY random() LIMIT 1';
    return queryOne(query, params);
  }

  static async getCaseById(id) {
    return queryOne('SELECT * FROM court_cases WHERE id = $1', [id]);
  }

  static async getCasePool() {
    return queryAll(
      'SELECT id, title, category, difficulty, summary FROM court_cases ORDER BY difficulty, title',
      []
    );
  }

  static createScenario(courtCase) {
    if (!courtCase || typeof courtCase !== 'object') return null;
    return {
      title: courtCase.title,
      charge: courtCase.category,
      facts: Array.isArray(courtCase.facts) ? courtCase.facts : [],
      statute: courtCase.statute || '',
      correct_verdict: courtCase.actual_verdict || '무죄',
      is_real_case: true,
      case_number: courtCase.case_number || '',
      category: courtCase.category,
      difficulty: courtCase.difficulty,
      actual_verdict: courtCase.actual_verdict,
      actual_reasoning: courtCase.actual_reasoning,
      learning_points: Array.isArray(courtCase.learning_points) ? courtCase.learning_points : [],
      source_url: courtCase.source_url || ''
    };
  }

  /**
   * Reveal the actual court verdict for a match.
   * Returns the real-case data if the match used a real case, null otherwise.
   */
  static async revealVerdict(matchMeta) {
    if (!matchMeta) return null;
    const ct = matchMeta.court_trial || matchMeta.courtTrial;
    if (!ct || !ct.is_real_case) return null;

    return {
      is_real_case: true,
      title: ct.title || '',
      category: ct.category || '',
      difficulty: ct.difficulty || 0,
      actual_verdict: ct.actual_verdict || '',
      actual_reasoning: ct.actual_reasoning || '',
      learning_points: Array.isArray(ct.learning_points) ? ct.learning_points : [],
      source_url: ct.source_url || '',
      ai_verdicts: {
        a: ct.a ? { verdict: ct.a.verdict, correct: ct.a.correct } : null,
        b: ct.b ? { verdict: ct.b.verdict, correct: ct.b.correct } : null
      }
    };
  }

  /**
   * Get case count by category for the case pool overview.
   */
  static async getCaseStats() {
    const rows = await queryAll(
      `SELECT category, difficulty, COUNT(*)::int as count
       FROM court_cases
       GROUP BY category, difficulty
       ORDER BY category, difficulty`,
      []
    );
    return rows;
  }
}

module.exports = CourtCaseService;
