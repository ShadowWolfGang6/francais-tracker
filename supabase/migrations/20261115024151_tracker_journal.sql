BEGIN;

CREATE SCHEMA IF NOT EXISTS tracker_private;
REVOKE ALL ON SCHEMA tracker_private FROM PUBLIC, anon, authenticated;

CREATE TABLE tracker_private.operations (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  entity_key text NOT NULL,
  UNIQUE (owner_id, operation_id)
);

CREATE TABLE tracker_private.records (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_key text NOT NULL,
  sequence bigint NOT NULL,
  entity_value jsonb,
  PRIMARY KEY (owner_id, entity_key)
);
CREATE INDEX tracker_records_owner_sequence ON tracker_private.records (owner_id, sequence);

ALTER TABLE tracker_private.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_private.records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracker_operations_by_owner ON tracker_private.operations
  FOR ALL TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY tracker_records_by_owner ON tracker_private.records
  FOR ALL TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
REVOKE ALL ON ALL TABLES IN SCHEMA tracker_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tracker_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION tracker_private.tracker_journal_pull(expected_owner uuid, after_sequence bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_owner uuid := auth.uid();
  result jsonb;
BEGIN
  IF active_owner IS NULL OR active_owner IS DISTINCT FROM expected_owner THEN
    RAISE EXCEPTION 'Sign in with the account for this journal.' USING ERRCODE = '42501';
  END IF;
  IF after_sequence IS NULL OR after_sequence NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid sync cursor.' USING ERRCODE = '22023';
  END IF;

  WITH journal_page AS (
    SELECT sequence, entity_key, entity_value
    FROM tracker_private.records
    WHERE owner_id = active_owner AND sequence > after_sequence
    ORDER BY sequence
    LIMIT 151
  ), events AS (
    SELECT sequence, entity_key, entity_value FROM journal_page ORDER BY sequence LIMIT 150
  )
  SELECT jsonb_build_object(
    'events', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('seq', sequence, 'key', entity_key, 'value', entity_value) ORDER BY sequence) FROM events),
      '[]'::jsonb
    ),
    'more', (SELECT count(*) > 150 FROM journal_page)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION tracker_private.tracker_journal_push(expected_owner uuid, entries jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_owner uuid := auth.uid();
  operation jsonb;
  item_key text;
  item_id text;
  item_value jsonb;
  applied_sequence bigint;
BEGIN
  IF active_owner IS NULL OR active_owner IS DISTINCT FROM expected_owner THEN
    RAISE EXCEPTION 'Sign in with the account for this journal.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid progress batch.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(entries) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Invalid progress batch size.' USING ERRCODE = '22023';
  END IF;

  -- Serialize writes to this journal so another device cannot advance past an uncommitted operation.
  PERFORM pg_advisory_xact_lock(hashtextextended(active_owner::text, 0));

  FOR operation IN SELECT value FROM jsonb_array_elements(entries)
  LOOP
    item_key := operation ->> 'key';
    item_id := operation ->> 'id';
    item_value := operation -> 'value';
    IF item_key IS NULL OR item_key !~ '^(log|duo|tv|speak|word|check|tvstep|milestone|prefs):[a-zA-Z0-9_.-]{1,120}$'
       OR item_id IS NULL OR item_id !~ '^[a-zA-Z0-9_-]{12,100}$'
       OR jsonb_typeof(operation -> 'key') IS DISTINCT FROM 'string'
       OR jsonb_typeof(operation -> 'id') IS DISTINCT FROM 'string'
       OR item_value IS NULL OR jsonb_typeof(item_value) NOT IN ('object', 'null')
       OR octet_length(item_value::text) > 60000 THEN
      RAISE EXCEPTION 'Invalid progress entry.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO tracker_private.operations (owner_id, operation_id, entity_key)
    VALUES (active_owner, item_id, item_key)
    ON CONFLICT (owner_id, operation_id) DO NOTHING
    RETURNING sequence INTO applied_sequence;
    IF NOT FOUND THEN CONTINUE; END IF;

    INSERT INTO tracker_private.records (owner_id, entity_key, sequence, entity_value)
    VALUES (active_owner, item_key, applied_sequence, nullif(item_value, 'null'::jsonb))
    ON CONFLICT (owner_id, entity_key) DO UPDATE
      SET sequence = excluded.sequence, entity_value = excluded.entity_value
      WHERE excluded.sequence > tracker_private.records.sequence;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Keep privileged functions outside the Data API's exposed schemas.
CREATE FUNCTION public.tracker_journal_pull(expected_owner uuid, after_sequence bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$ SELECT tracker_private.tracker_journal_pull(expected_owner, after_sequence) $$;

CREATE FUNCTION public.tracker_journal_push(expected_owner uuid, entries jsonb)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $$ SELECT tracker_private.tracker_journal_push(expected_owner, entries) $$;

GRANT USAGE ON SCHEMA tracker_private TO authenticated;
REVOKE ALL ON FUNCTION tracker_private.tracker_journal_pull(uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION tracker_private.tracker_journal_push(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracker_journal_pull(uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracker_journal_push(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tracker_private.tracker_journal_pull(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION tracker_private.tracker_journal_push(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_journal_pull(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_journal_push(uuid,jsonb) TO authenticated;

COMMIT;
