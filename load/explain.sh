#!/usr/bin/env bash
# EXPLAIN (ANALYZE, BUFFERS) of the top query shapes from the load test, on a stack left up
# with KEEP_STACK=1 (load/README.md). Each runs as its module's role, with real sample ids.
# Output: load/out/explain.txt
set -euo pipefail
cd "$(dirname "$0")/.."
P() { docker exec -i vouch-load-postgres-1 psql -U vouch -d vouch -At "$@"; }
IFS='|' read -r ME G INTO MINA MAXA CL AGE <<< "$(P -c "
  SELECT u.id, p.gender, p.interested_in::text, p.min_age, p.max_age, c.cluster_id,
         date_part('year', age(now()::date, p.birth_date))::int
  FROM identity.users u JOIN profiles.profiles p ON p.user_id = u.id
  JOIN platform.colleges c ON c.id = u.college_id
  WHERE p.status = 'active' ORDER BY u.id LIMIT 1")"
CONV="$(P -c "SELECT id FROM chat.conversations ORDER BY last_seq DESC LIMIT 1")"
MEMBER="$(P -c "SELECT user_low FROM chat.conversations WHERE id = '$CONV'")"
IDS="$(P -c "SELECT array_agg(id)::text FROM (SELECT id FROM identity.users LIMIT 20) x")"

explain() {
  echo "=== $1 (role $2)"
  P <<SQL
SET ROLE $2;
EXPLAIN (ANALYZE, BUFFERS, SUMMARY) $3;
SQL
  echo
}
{
explain "1. deck candidates (discovery)" vouch_discovery "
  SELECT c.user_id, c.college_id, c.gender, c.interested_in, a.age, c.min_age, c.max_age,
    c.last_active_at, c.created_at, c.approved_photos::int
  FROM profiles.candidates_v c JOIN identity.active_users_v u ON u.id = c.user_id
  CROSS JOIN LATERAL (SELECT date_part('year', age(now()::date, c.birth_date))::int AS age) a
  WHERE c.cluster_id = '$CL' AND c.user_id <> '$ME' AND c.gender = ANY('$INTO'::smallint[])
    AND $G::smallint = ANY(c.interested_in) AND a.age BETWEEN $MINA AND $MAXA
    AND $AGE BETWEEN c.min_age AND c.max_age
    AND NOT EXISTS (SELECT 1 FROM matching.seen_v s WHERE s.swiper_id = '$ME' AND s.target_id = c.user_id)
    AND NOT EXISTS (SELECT 1 FROM safety.block_pairs_v b WHERE b.user_id = '$ME' AND b.other_id = c.user_id)
  ORDER BY c.last_active_at DESC LIMIT 400"
explain "2. deck viewer (discovery)" vouch_discovery "
  SELECT c.user_id, c.cluster_id, c.gender FROM profiles.candidates_v c
  JOIN identity.active_users_v u ON u.id = c.user_id WHERE c.user_id = '$ME'"
explain "3. users by ids (identity)" vouch_identity "SELECT * FROM identity.users WHERE id = ANY('$IDS'::uuid[])"
explain "4. user by id (identity)" vouch_identity "SELECT * FROM identity.users WHERE id = '$ME'"
explain "5. conversation list (chat)" vouch_chat "
  SELECT * FROM (SELECT c.id, c.last_seq, coalesce(m.created_at, c.created_at) AS activity_at
    FROM chat.conversations c LEFT JOIN chat.messages m ON m.conversation_id = c.id AND m.seq = c.last_seq
    WHERE c.user_low = '$MEMBER' OR c.user_high = '$MEMBER') x
  ORDER BY x.activity_at DESC, x.id DESC LIMIT 21"
explain "6. colleges by ids (platform view)" vouch_profiles "
  SELECT id, name, cluster_id FROM platform.colleges_v WHERE id = ANY(ARRAY['$CL']::uuid[])"
explain "7. profile sections (profiles)" vouch_profiles "
  SELECT user_id, type, data, position FROM profiles.profile_sections
  WHERE user_id = ANY('$IDS'::uuid[]) ORDER BY position, type"
explain "8. seen among (discovery)" vouch_discovery "
  SELECT target_id FROM matching.seen_v WHERE swiper_id = '$ME' AND target_id = ANY('$IDS'::uuid[])"
explain "9. likes count (matching)" vouch_matching "
  SELECT count(*)::int FROM matching.swipes l WHERE l.target_id = '$ME' AND l.direction = 1
    AND NOT EXISTS (SELECT 1 FROM matching.swipes s WHERE s.swiper_id = '$ME' AND s.target_id = l.swiper_id)
    AND NOT EXISTS (SELECT 1 FROM safety.block_pairs_v b WHERE b.user_id = '$ME' AND b.other_id = l.swiper_id)"
explain "10. message history (chat)" vouch_chat "
  SELECT conversation_id, seq, sender_id, body, created_at FROM chat.messages
  WHERE conversation_id = '$CONV' AND seq > 0 ORDER BY seq LIMIT 30"
} > load/out/explain.txt 2>&1
grep -E '^===|Planning Time|Execution Time' load/out/explain.txt
