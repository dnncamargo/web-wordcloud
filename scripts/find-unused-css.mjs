import fs from "fs";
import path from "path";

const root = process.cwd();
const cssPath = path.join(root, "app", "globals.css");

const searchDirs = ["app", "components", "lib"];

function readFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) return [];
      return readFiles(fullPath);
    }

    if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      return [fullPath];
    }

    return [];
  });
}

const css = fs.readFileSync(cssPath, "utf8");

const classNames = [...css.matchAll(/\.([a-zA-Z0-9_-]+)/g)]
  .map((match) => match[1])
  .filter((name) => !name.match(/^\d/));

const uniqueClassNames = [...new Set(classNames)];

const sourceText = searchDirs
  .flatMap((dir) => readFiles(path.join(root, dir)))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

const unused = uniqueClassNames.filter((className) => {
  return !sourceText.includes(className);
});

console.log("Possivelmente não usadas:");
console.log(unused.sort().join("\n"));