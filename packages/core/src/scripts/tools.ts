import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Une commande qu'on lance depuis la liste des scripts, avec la ligne qui la lance. */
export interface ToolCommand {
  name: string;
  /** Ligne tapée dans PowerShell, depuis le dossier de l'outil. */
  run: string;
}

/** Les commandes d'un outil du projet, au-delà des scripts du `package.json`. */
export interface ToolScripts {
  tool: "make" | "cargo" | "go" | "python" | "powershell" | "shell";
  /** Dossier d'où les lancer. */
  directory: string;
  commands: ToolCommand[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cibles d'un Makefile, dans l'ordre du fichier : les lignes `nom:` qui ne sont
 * ni une affectation (`X := …`), ni une cible spéciale (`.PHONY`), ni un motif
 * (`%.o:`).
 */
export function makeTargets(text: string): string[] {
  const targets: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_.\/-]*)\s*:(?![:=])/.exec(line);
    const name = match?.[1];
    if (name && !targets.includes(name)) targets.push(name);
  }
  return targets;
}

/** Guillemets simples de PowerShell, apostrophes doublées. */
function quoted(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

/** Scripts PowerShell et shell d'un dossier, par ordre alphabétique. */
async function scriptFiles(directory: string): Promise<{ ps1: string[]; sh: string[] }> {
  let names: string[] = [];
  try {
    names = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return { ps1: [], sh: [] };
  }
  names.sort((a, b) => a.localeCompare(b));
  return { ps1: names.filter((name) => /\.ps1$/i.test(name)), sh: names.filter((name) => /\.sh$/i.test(name)) };
}

/**
 * Les outils qu'on reconnaît à la racine d'un projet, et ce qu'on y lance
 * d'habitude. Ce qui manque n'apparaît pas : un projet sans Makefile n'a pas de
 * section make.
 */
export async function detectTools(root: string): Promise<ToolScripts[]> {
  const tools: ToolScripts[] = [];

  const makefile = (await exists(join(root, "Makefile"))) ? join(root, "Makefile") : (await exists(join(root, "makefile"))) ? join(root, "makefile") : undefined;
  if (makefile) {
    const targets = makeTargets(await readFile(makefile, "utf8"));
    if (targets.length > 0) tools.push({ tool: "make", directory: root, commands: targets.map((name) => ({ name, run: `make ${name}` })) });
  }

  if (await exists(join(root, "Cargo.toml"))) {
    tools.push({
      tool: "cargo",
      directory: root,
      commands: ["build", "run", "test", "check", "clippy"].map((name) => ({ name, run: `cargo ${name}` })),
    });
  }

  if (await exists(join(root, "go.mod"))) {
    tools.push({
      tool: "go",
      directory: root,
      commands: [
        { name: "build", run: "go build ./..." },
        { name: "run", run: "go run ." },
        { name: "test", run: "go test ./..." },
        { name: "vet", run: "go vet ./..." },
      ],
    });
  }

  const python = (await exists(join(root, "pyproject.toml"))) || (await exists(join(root, "setup.py"))) || (await exists(join(root, "requirements.txt")));
  if (python) {
    const commands: ToolCommand[] = [];
    if ((await exists(join(root, "tests"))) || (await exists(join(root, "test")))) commands.push({ name: "pytest", run: "python -m pytest" });
    if (await exists(join(root, "requirements.txt"))) commands.push({ name: "install", run: "python -m pip install -r requirements.txt" });
    if (await exists(join(root, "manage.py"))) commands.push({ name: "runserver", run: "python manage.py runserver" });
    if (commands.length > 0) tools.push({ tool: "python", directory: root, commands });
  }

  // Scripts à la racine et dans `scripts/`, le dossier où on les range d'habitude.
  const powershell: ToolCommand[] = [];
  const shell: ToolCommand[] = [];
  for (const folder of ["", "scripts"]) {
    const { ps1, sh } = await scriptFiles(join(root, folder));
    const prefix = folder ? `${folder}/` : "";
    for (const name of ps1) powershell.push({ name: `${prefix}${name}`, run: `& ${quoted(`./${prefix}${name}`)}` });
    for (const name of sh) shell.push({ name: `${prefix}${name}`, run: `bash ${quoted(`./${prefix}${name}`)}` });
  }
  if (powershell.length > 0) tools.push({ tool: "powershell", directory: root, commands: powershell });
  if (shell.length > 0) tools.push({ tool: "shell", directory: root, commands: shell });

  return tools;
}
