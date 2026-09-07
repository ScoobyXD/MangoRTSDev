"""Opt-in public web read smoke; uses no account secrets or provider writes."""

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--live-public-read", action="store_true", required=True)
    args = parser.parse_args()
    sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(args.source)]
    import mango_integrations
    with tempfile.TemporaryDirectory(prefix="mango-web-fixture-") as temporary:
        os.environ["HERMES_HOME"] = temporary
        (Path(temporary) / "config.yaml").write_text(json.dumps({"web": mango_integrations.DEFAULT_WEB}))
        from tools.web_tools import _ensure_web_plugins_loaded
        from tools.registry import registry
        _ensure_web_plugins_loaded()
        available = {item["function"]["name"] for item in registry.get_definitions({"web_search", "web_extract"})}
        assert available == {"web_search", "web_extract"}, available
        for name, arguments in (
            ("web_search", {"query": "site:modelcontextprotocol.io tools specification", "limit": 1}),
            ("web_extract", {"urls": ["https://modelcontextprotocol.io/docs/learn/server-concepts"]}),
        ):
            result = json.loads(registry.dispatch(name, arguments))
            if result.get("error") or result.get("success") is False:
                raise RuntimeError(name + " failed: " + str(result.get("error", "unsuccessful provider result")))
            if name == "web_search":
                assert result.get("data", {}).get("web"), "Search returned no provider results."
            else:
                assert any(item.get("content") and not item.get("error") for item in result.get("results", [])), "Extraction returned no page content."
            print(name + ": " + json.dumps(result)[:400])
        print("PASS: native public web search and page extraction returned provider data.")


if __name__ == "__main__":
    main()
