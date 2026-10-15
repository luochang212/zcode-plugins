# External plugins

[中文说明](./README_CN.md)

This directory holds new plugins contributed by external teams, partners, and the community. Each plugin lives in `external_plugins/<name>/` and must be registered in the root [marketplace.json](../marketplace.json).

The publisher derives `publisherType: community` from this directory. Usage `category` and component capabilities are separate from publisher classification. External plugins use the same marketplace and ZIP distribution workflow as other plugins.

Existing plugins remain in `plugins/` for now. Do not move them here as part of this directory setup. These README files describe the directory and are not an installable plugin.

See the [contribution guide](../CONTRIBUTING.md), [plugin development guide](../docs/PLUGIN_DEVELOPMENT.md), and [distribution contract](../docs/distribution.md) before adding a plugin.
