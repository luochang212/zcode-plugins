"""Opt-in real CLI checks with fresh config; never login or send messages.

Set CLI_SMOKE_DWS and CLI_SMOKE_WECOM to absolute executable paths.
Commands are allowlisted argv, not arbitrary shell blocks from Skills.
"""

import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def documented(plugin, skill, argv):
    text = (ROOT / "plugins" / plugin / "skills" / skill / "SKILL.md").read_text()
    commands = [
        shlex.split(line)
        for block in re.findall(r"```bash\n(.*?)```", text, re.S)
        for line in block.splitlines() if line.strip()
    ]
    if argv not in commands:
        raise AssertionError(f"{plugin}/{skill}: reviewed example missing")
    return argv


class MessagingCLIRuntime(unittest.TestCase):
    def run_cli(self, vendor, args):
        binary = os.environ.get(f"CLI_SMOKE_{vendor}")
        if not binary:
            self.skipTest(f"set CLI_SMOKE_{vendor} for real CLI checks")
        self.assertTrue(Path(binary).is_absolute() and Path(binary).is_file())
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("DWS_", "DINGTALK_", "WECOM_"))}
        with tempfile.TemporaryDirectory(prefix="messaging-cli-test-") as directory:
            env.update({"DWS_CONFIG_DIR": directory, "WECOM_CLI_CONFIG_DIR": directory,
                        "DO_NOT_TRACK": "1"})
            try:
                return subprocess.run([binary, *args], cwd=directory, env=env,
                                      capture_output=True, text=True, timeout=30)
            except subprocess.TimeoutExpired:
                self.fail("CLI timed out; raw output suppressed")

    def test_dws_unauthenticated_exit_zero_is_not_ready(self):
        argv = documented("dingtalk-cli", "setup", ["dws", "auth", "status", "--format", "json"])
        result = self.run_cli("DWS", argv[1:])
        self.assertEqual(result.returncode, 0)
        self.assertIs(json.loads(result.stdout)["authenticated"], False)

    def test_dws_fresh_profiles_empty(self):
        argv = documented("dingtalk-cli", "setup", ["dws", "profile", "list", "--format", "json"])
        result = self.run_cli("DWS", argv[1:])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["profiles"], [])

    def test_dws_unknown_profile_rejected(self):
        result = self.run_cli("DWS", ["auth", "status", "--profile", "missing:missing", "--format", "json"])
        self.assertNotEqual(result.returncode, 0)

    def test_dws_setup_supports_zcode_and_device_login(self):
        argv = documented("dingtalk-cli", "setup", ["dws", "skill", "setup", "--help"])
        result = self.run_cli("DWS", argv[1:])
        self.assertEqual(result.returncode, 0)
        self.assertIn("zcode", result.stdout)
        self.assertIn("--dry-run", result.stdout)
        login = documented("dingtalk-cli", "setup", ["dws", "auth", "login", "--device"])
        result = self.run_cli("DWS", [*login[1:], "--help"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("--device", result.stdout)

    def test_wecom_unauthorized_exit_zero_is_not_ready(self):
        argv = documented("wecom-cli", "setup", ["wecom-cli", "auth", "show", "--status"])
        result = self.run_cli("WECOM", argv[1:])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "unauthorized")

    def test_wecom_qr_and_manual_login_help(self):
        for flag in ("--noninteractive", "--manual"):
            argv = documented("wecom-cli", "setup", ["wecom-cli", "auth", "init", flag])
            result = self.run_cli("WECOM", [*argv[1:], "--help"])
            self.assertEqual(result.returncode, 0)
            self.assertIn(flag, result.stdout)

    def search(self):
        return documented("wecom-cli", "cli", ["wecom-cli", "doc", "search", "--json",
                                                '{"keywords":["周报"],"limit":1}'])[1:]

    def test_wecom_documented_read_schema_and_dry_run(self):
        for flag in ("--help", "--schema", "--dry-run"):
            with self.subTest(flag=flag):
                result = self.run_cli("WECOM", [*self.search(), flag])
                self.assertEqual(result.returncode, 0, "example failed; raw output suppressed")
                self.assertIn("keywords", result.stdout)

    def test_wecom_read_without_auth_fails(self):
        result = self.run_cli("WECOM", self.search())
        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr + result.stdout, r"(?i)(auth|凭据|授权|认证)")

    def test_wecom_dry_run_does_not_validate_json_schema(self):
        result = self.run_cli("WECOM", ["doc", "search", "--json", '{"limit":"bad"}', "--dry-run"])
        # Current CLI accepts syntactically valid JSON without method schema checks.
        self.assertEqual(result.returncode, 0)
        self.assertIn('"limit": "bad"', result.stdout)


if __name__ == "__main__":
    unittest.main()
