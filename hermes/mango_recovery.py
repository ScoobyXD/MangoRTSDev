"""Explicit startup repair through the existing native snapshot and durable FIFO."""

import json
import os
from pathlib import Path
import re
from uuid import uuid4

from mango_scope import bound_profile, profile_name, profiles


def queue_history_repairs(raw):
    """Queue current saved state before gateway execution; never execute a run."""
    if len(raw.encode("utf-8")) > 262144:
        raise ValueError("History repair input is too large.")
    requests = json.loads(raw)
    if not isinstance(requests, list):
        raise ValueError("History repairs must be a list of exact admitted runs.")
    if not requests:
        return 0
    served = profiles()
    validated, seen = [], set()
    for item in requests:
        if (not isinstance(item, dict)
                or set(item) != {"company_id", "user_id", "run_id", "session_id"}
                or any(not isinstance(value, str) for value in item.values())):
            raise ValueError("History repair requires exact company, user, run and session IDs.")
        name = profile_name(item["company_id"], item["user_id"])
        if (served.get(name) != {"company_id": item["company_id"], "user_id": item["user_id"]}
                or not re.fullmatch(r"run_[0-9a-f]{32}", item["run_id"])
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", item["session_id"])):
            raise ValueError("History repair does not name a configured exact native run.")
        identity = name, item["run_id"]
        if identity in seen:
            raise ValueError("Duplicate native history repair.")
        seen.add(identity)
        validated.append((name, item["run_id"], item["session_id"]))

    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    import mango_history

    root = Path(os.environ["HERMES_HOME"])
    for name, run_id, session_id in validated:
        home = root / "profiles" / name
        bound_profile(home)
        # Startup owns this process. Delivery starts only when the native gateway
        # loads the plugin after exec, so capture cannot race model execution.
        queue = mango_history.profile_outbox(home, start_worker=False)
        with queue.connect() as db:
            if db.execute("SELECT 1 FROM events WHERE run_id=? AND rejected_status IS NOT NULL LIMIT 1", (run_id,)).fetchone():
                raise ValueError("History repair requires review of a previously rejected native run.")
        token = set_hermes_home_override(home)
        try:
            recovery_id = "recovery:" + uuid4().hex
            context = run_id, session_id
            mango_history.snapshot(context, recovery_id)
            mango_history._event(context, "history.recovered", recovery_id)
        finally:
            reset_hermes_home_override(token)
    return len(validated)
