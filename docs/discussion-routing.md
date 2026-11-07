# Discussion thread routing

Hosted Ask AI uses the installation's default agent, model and provider unless configured.
Set `WISDOM_THREAD_AGENT`, `WISDOM_THREAD_MODEL`, and optionally `WISDOM_THREAD_PROVIDER`
in the app environment to override them. Empty/unset values are omitted from requests so
Wizard selects the owner's defaults; no model lock is requested without an explicit model.
Existing discussion bindings retain their recorded agent to avoid moving an owner's thread.
