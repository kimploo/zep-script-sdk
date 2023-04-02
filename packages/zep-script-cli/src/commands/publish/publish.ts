import axios from "axios";
import prompt from "prompt";
import FormData from "form-data";
import fs from "fs-extra";
import ora, { Ora } from "ora";
import os from "os";
import path from "path";
import logger from "../../tools/logger";
import execa from "execa";

type Options = {
  projectRoot?: string;
};

async function auth(loader: Ora, sessionFilePath: string) {
  prompt.start();

  const { email } = await prompt.get({
    name: "email",
    description: "Enter your email",
    type: "string",
    required: true,
  });

  loader.start("Sending login code to your email...");

  const loginData = {email};

  await axios.post("https://zep.us/api/v2/signin", loginData);

  loader.succeed();

  const { code } = await prompt.get({
    name: "code",
    description: "Enter code sent to your email",
    type: "string",
    required: true,
  });

  const confirmData = new FormData();
  confirmData.append("email", email);
  confirmData.append("t", code);

  loader.start("Authenticating...");

  const { headers } = await axios.post(
    "https://zep.us/api/me/signin/confirm",
    confirmData
  );

  const sessionCookie = headers["set-cookie"]![0];
  await fs.writeFile(sessionFilePath, sessionCookie);

  loader.succeed();
}

async function findArchiveFile(root: string) {
  const archiveFiles = fs
    .readdirSync(root)
    .filter((file) => file.endsWith(".zepapp.zip"));

  if (archiveFiles.length === 0) {
    throw new Error("No archive file found.");
  }

  return archiveFiles[0];
}

export default (async function publish([]: Array<string>, options: Options) {
  const cwd = process.cwd();
  const root = options.projectRoot || cwd;

  const loader = ora();

  try {
    const configJsonPath = path.join(root, "zep-script.json");
    const configJsonObject = JSON.parse(
      fs.readFileSync(configJsonPath).toString()
    );

    const sessionFilePath = path.join(os.homedir(), ".zscsession");

    if (!fs.existsSync(sessionFilePath)) {
      await auth(loader, sessionFilePath);
    }

    const sessionCookie = (await fs.readFile(sessionFilePath)).toString();

    const archiveFilePath = await findArchiveFile(root);
    const archiveFile = fs.createReadStream(archiveFilePath);

    const formData = new FormData();
    formData.append("file", archiveFile, archiveFilePath);
    formData.append("name", configJsonObject.name);
    formData.append("desc", configJsonObject.description);

    let type = "1";
    switch (configJsonObject.type) {
      case "minigame":
        type = "2";
        break;
      case "sidebar":
        type = "3";
    }
    formData.append("type", type);

    const appId = configJsonObject.appId || "create";

    loader.start("Publishing...");

    const length = await new Promise<number>((resolve) =>
      formData.getLength((e, l) => resolve(l))
    );

    const response = await axios.post(`https://zep.us/iframe/me/apps/${appId}`, formData, {
      headers: {
        cookie: sessionCookie,
        "Content-Length": length,
        ...formData.getHeaders(),
      },
    });
    const resAppId = response.request.path.split("/iframe/me/apps/")[1];
    if (resAppId && (appId !== resAppId)) {
      configJsonObject.appId = resAppId;

      await fs.writeFile(configJsonPath, JSON.stringify(configJsonObject, null, 4));

      await execa(
        "yarn",
        ["zep-script", "build"]
      );
      await execa(
        "yarn",
        ["zep-script", "archive"]
      );
      await publish([], options);
    }

    loader.succeed();
  } catch (e) {
    loader.fail();
    if (e instanceof Error) {
      logger.error(e.message);
    }
  }
});
