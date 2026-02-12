-- 초기 코인(INITIAL) 중복 발행 방지를 위한 partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_initial_unique
  ON transactions (to_agent_id)
  WHERE tx_type = 'INITIAL';
