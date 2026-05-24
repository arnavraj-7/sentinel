"""Code-patch sub-graph package.

This __init__.py is INTENTIONALLY EMPTY (no re-exports) to break a circular
import that the convenient "public API" __init__.py would otherwise create.

The cycle that re-exports cause:

    agents/state.py
        → wants CodePatchResult (for the `code_patch_result` field type)
        → imports from `sentinel.subgraph.codepatch...`
        → Python runs THIS __init__.py FIRST (always, before any submodule)
        → __init__.py imports `code_patch_node` from `.graph`
        → `.graph` imports IncidentState from `agents.state`
        → but `agents.state` is still being loaded → ImportError.

The fix is structural: __init__.py only re-exports from submodules that DO
NOT import back into the parent. Since `.graph` legitimately needs the
parent's IncidentState (the wrapper takes it as input), we cannot re-export
anything that transitively pulls `.graph` in here.

Consumers therefore import from the leaf modules directly:

    from sentinel.subgraph.codepatch.state import CodePatchResult
    from sentinel.subgraph.codepatch.graph import code_patch_node

`state.py` is a true leaf (no imports from `sentinel.agents`), so importing
it from `agents/state.py` is safe even though it triggers this __init__.py —
this file does nothing. `.graph` only gets loaded later, by `agents/graph.py`,
by which time `agents/state.py` is fully initialised.
"""
