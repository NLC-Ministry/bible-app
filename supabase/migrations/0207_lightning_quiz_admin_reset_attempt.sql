-- ============================================================================
-- 快問快答：讓 admin 可以清掉自己的測試作答，重新再測一次
-- ============================================================================
-- 使用者回饋：admin 在測試模式下答過一次之後，UNIQUE(question_id, user_id)
-- 會擋住同一題再次開始作答（start_lightning_quiz_attempt 對已完成的攻略直接
-- RAISE 'lightning_quiz_already_answered'），如果編輯題目內容想重新測試一次，
-- 沒有任何入口可以清掉舊的測試紀錄。
-- 使用者明確要求：不要做成「編輯題目就自動覆蓋/清掉舊資料」，而是「我自己在
-- 後台手動刪除舊資料就好」——所以這裡只新增一支「刪除呼叫者自己那筆作答」的
-- RPC，不改動既有的 upsert/delete 題目邏輯，編輯題目內容完全不會動到
-- lightning_quiz_attempts。
--
-- 安全設計：只刪 `user_id = actor_id` 自己的那一筆（WHERE 條件寫死綁自己），
-- 就算呼叫者是系統管理員，也不可能透過這支 RPC 刪到別人（含其他 admin）的
-- 作答紀錄。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_reset_lightning_quiz_attempt(
  p_question_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id      UUID := public.resolve_quiz_actor(p_actor_id);
  deleted_count INT;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  DELETE FROM public.lightning_quiz_attempts
  WHERE question_id = p_question_id AND user_id = actor_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('reset', deleted_count > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_lightning_quiz_attempt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_lightning_quiz_attempt(uuid, uuid) TO authenticated, service_role;
