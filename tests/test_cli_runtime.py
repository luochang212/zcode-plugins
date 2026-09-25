"""Executable CLI examples and opt-in read-only smoke tests.

Set CLI_SMOKE_ALIYUN / CLI_SMOKE_LARK to absolute binary paths to exercise
fresh, unauthenticated configurations. CLI_SMOKE_EXISTING=1 additionally
permits reads using existing local credentials (never login or cloud writes).
No software is installed by this suite. Raw CLI responses are never logged.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def examples(plugin: str, skill: str = "setup") -> list[list[str]]:
    text = (ROOT / "plugins" / plugin / "skills" / skill / "SKILL.md").read_text()
    return [
        shlex.split(line, comments=True)
        for block in re.findall(r"```bash\n(.*?)```", text, re.DOTALL)
        for line in block.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def documented(plugin: str, expected: list[str], skill: str = "setup") -> list[str]:
    """Only an exact, reviewed argv is eligible for execution; never a shell."""
    if expected not in examples(plugin, skill):
        raise AssertionError(f"{plugin}/{skill}: reviewed command missing")
    return expected


IDENTITY = ["aliyun", "sts", "GetCallerIdentity", "--auto-plugin-install", "false"]
STATUS = ["lark-cli", "auth", "status", "--json", "--verify"]


class CLIExampleSafetyTests(unittest.TestCase):
    def test_aliyun_examples_disable_install_and_use_default_json(self):
        documented("alibaba-cloud-cli", IDENTITY)
        for skill in ("setup", "cli"):
            for argv in examples("alibaba-cloud-cli", skill):
                if argv[0] != "aliyun" or argv[1] in {"version", "plugin", "configure"}:
                    continue
                with self.subTest(argv=argv):
                    self.assertNotIn("--output", argv)
                    self.assertIn("--auto-plugin-install", argv)
                    self.assertEqual(argv[argv.index("--auto-plugin-install") + 1], "false")

    def test_lark_install_is_cli_only_and_agent_login_is_split(self):
        commands = examples("lark-cli")
        self.assertIn(["npm", "install", "-g", "@larksuite/cli@latest"], commands)
        self.assertFalse(any(argv[0] == "npx" for argv in commands))
        documented("lark-cli", STATUS)
        for argv in commands:
            if argv[:3] == ["lark-cli", "auth", "login"] and "--device-code" not in argv:
                self.assertIn("--no-wait", argv)
                self.assertIn("--json", argv)
                self.assertIn("--scope", argv)

class RuntimeChecks(unittest.TestCase):
    def run_cli(self, variable, argv, *, fresh=True):
        binary = os.environ.get(variable)
        if not binary:
            self.skipTest(f"set {variable} to opt into CLI smoke checks")
        if not Path(binary).is_absolute() or not Path(binary).is_file():
            self.fail(f"{variable} must identify an existing absolute binary path")
        env = dict(os.environ)
        with tempfile.TemporaryDirectory(prefix="zcode-cli-smoke-") as directory:
            if fresh:
                # Do not inherit credential, endpoint, or profile overrides.
                env = {k: v for k, v in env.items() if not k.startswith(
                    ("ALIBABA_CLOUD_", "ALIBABACLOUD_", "ALICLOUD_", "LARKSUITE_", "LARK_")
                )}
            env.update({
                "LARKSUITE_CLI_NO_UPDATE_NOTIFIER": "1",
                "LARKSUITE_CLI_NO_SKILLS_NOTIFIER": "1",
            })
            if argv[0] == "aliyun":
                env["ALIBABA_CLOUD_CLI_PLUGINS_DIR"] = str(Path(directory) / "plugins")
                if fresh:
                    config = Path(directory) / "config.json"
                    config.write_text(json.dumps({"current": "default", "profiles": []}))
                    argv = [*argv, "--config-path", str(config)]
            elif fresh:
                env["LARKSUITE_CLI_CONFIG_DIR"] = str(Path(directory) / "lark")
            try:
                return subprocess.run(
                    [binary, *argv[1:]], env=env, cwd=directory,
                    capture_output=True, text=True, timeout=30, check=False,
                )
            except subprocess.TimeoutExpired:
                self.fail("CLI timed out; output suppressed")

    def payload(self, result, *, error=False):
        try:
            value = json.loads(result.stderr if error else result.stdout)
        except (ValueError, TypeError):
            self.fail(f"CLI returned non-JSON output (exit={result.returncode}); output suppressed")
        self.assertTrue(isinstance(value, dict), "expected JSON object; output suppressed")
        return value

    def existing(self):
        if os.environ.get("CLI_SMOKE_EXISTING") != "1":
            self.skipTest("set CLI_SMOKE_EXISTING=1 to permit existing-account read-only calls")

    def test_aliyun_fresh_help_and_default_json_regression(self):
        argv = documented("alibaba-cloud-cli", [*IDENTITY, "--help"])
        good = self.run_cli("CLI_SMOKE_ALIYUN", argv)
        self.assertEqual(good.returncode, 0, "documented help failed; output suppressed")
        bad = self.run_cli("CLI_SMOKE_ALIYUN", [*argv, "--output", "json"])
        self.assertNotEqual(bad.returncode, 0)

    def test_aliyun_fresh_identity_fails_closed(self):
        result = self.run_cli("CLI_SMOKE_ALIYUN", documented("alibaba-cloud-cli", IDENTITY))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("profile", (result.stdout + result.stderr).lower())

    def test_lark_fresh_auth_fails_closed(self):
        result = self.run_cli("CLI_SMOKE_LARK", documented("lark-cli", STATUS))
        self.assertNotEqual(result.returncode, 0)
        payload = self.payload(result, error=True)
        self.assertIs(payload.get("ok"), False)
        self.assertEqual(payload.get("error", {}).get("subtype"), "not_configured")

    def test_lark_documented_business_example_help(self):
        argv = documented("lark-cli", [
            "lark-cli", "calendar", "+agenda", "--as", "user", "--format", "json",
        ])
        result = self.run_cli("CLI_SMOKE_LARK", [*argv, "--help"])
        self.assertEqual(result.returncode, 0)

    def test_aliyun_existing_identity(self):
        self.existing()
        result = self.run_cli("CLI_SMOKE_ALIYUN", documented("alibaba-cloud-cli", IDENTITY), fresh=False)
        self.assertEqual(result.returncode, 0, "identity request failed; output suppressed")
        payload = self.payload(result)
        self.assertTrue(bool(payload.get("AccountId")))
        self.assertTrue(bool(payload.get("Arn")))

    def test_aliyun_existing_product_read(self):
        self.existing()
        result = self.run_cli("CLI_SMOKE_ALIYUN", [
            "aliyun", "ecs", "DescribeRegions", "--auto-plugin-install", "false",
        ], fresh=False)
        self.assertEqual(result.returncode, 0, "ECS read failed; output suppressed")
        self.assertTrue(isinstance(self.payload(result).get("Regions", {}).get("Region"), list))

    def test_lark_existing_identity(self):
        self.existing()
        result = self.run_cli("CLI_SMOKE_LARK", documented("lark-cli", STATUS), fresh=False)
        self.assertEqual(result.returncode, 0)
        payload = self.payload(result)
        self.assertEqual(payload.get("identity"), "user")
        self.assertIs(payload.get("verified"), True)

    def test_lark_existing_search_read(self):
        self.existing()
        result = self.run_cli("CLI_SMOKE_LARK", [
            "lark-cli", "drive", "+search", "--query", "CLI", "--page-size", "1",
            "--as", "user", "--format", "json",
        ], fresh=False)
        self.assertEqual(result.returncode, 0, "search read failed; output suppressed")
        payload = self.payload(result)
        self.assertIs(payload.get("ok"), True)
        self.assertEqual(payload.get("identity"), "user")
        self.assertTrue(isinstance(payload.get("data", {}).get("results"), list))


if __name__ == "__main__":
    unittest.main()
