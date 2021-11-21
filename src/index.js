import Module from "module";
import path from "path";
import { pathToFileURL } from "url";

import { build } from "esbuild";

import schema from "./options.json";

const parentModule = module;

function execute(code, loaderContext) {
  const module = new Module(loaderContext.resource, parentModule);

  // eslint-disable-next-line no-underscore-dangle
  module.paths = Module._nodeModulePaths(loaderContext.context);
  module.filename = loaderContext.resource;

  // eslint-disable-next-line no-underscore-dangle
  module._compile(code, loaderContext.resource);

  return module.exports;
}

function processResult(loaderContext, result) {
  if (!result || typeof result !== "object" || "code" in result === false) {
    loaderContext.callback(
      new Error(
        `The returned result of module "${loaderContext.resource}" is not an object with a "code" property`
      )
    );

    return;
  }

  if (
    typeof result.code !== "string" &&
    result.code instanceof Buffer === false
  ) {
    loaderContext.callback(
      new Error(
        `The returned code of module "${loaderContext.resource}" is neither a string nor an instance of Buffer`
      )
    );

    return;
  }

  (result.dependencies || []).forEach((dep) =>
    loaderContext.addDependency(dep)
  );

  (result.contextDependencies || []).forEach((dep) =>
    loaderContext.addContextDependency(dep)
  );

  (result.buildDependencies || []).forEach((dep) =>
    loaderContext.addBuildDependency(dep)
  );

  // Defaults to false which is a good default here because we assume that
  // results tend to be not cacheable when this loader is necessary
  loaderContext.cacheable(Boolean(result.cacheable));

  loaderContext.callback(
    null,
    result.code,
    result.sourceMap || null,
    result.ast || null
  );
}

export default async function loader(content) {
  const options = this.getOptions(schema);
  const { executableFile } = options;
  const callback = this.async();

  let exports;

  if (executableFile) {
    try {
      // eslint-disable-next-line global-require,import/no-dynamic-require
      exports = require(executableFile);
    } catch (requireError) {
      try {
        let importESM;

        try {
          // eslint-disable-next-line no-new-func
          importESM = new Function("id", "return import(id);");
        } catch (e) {
          importESM = null;
        }

        if (
          requireError.code === "ERR_REQUIRE_ESM" &&
          pathToFileURL &&
          importESM
        ) {
          const urlForConfig = pathToFileURL(executableFile);

          exports = await importESM(urlForConfig);
        } else {
          throw requireError;
        }
      } catch (error) {
        callback(new Error(`Unable to require "${executableFile}": ${error}`));

        return;
      }
    }
  } else {
    try {
      const { outputFiles } = await build({
        stdin: {
          contents: content,
          sourcefile: this.resourcePath,
          loader: "tsx",
          resolveDir: path.dirname(this.resourcePath),
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "cjs",
        plugins: [
          {
            name: "node-externals",
            // eslint-disable-next-line no-shadow
            setup(build) {
              // @see https://github.com/evanw/esbuild/issues/619#issuecomment-751995294
              const filter = /^[^./@~]|^\.[^./]|^\.\.[^/]|^@[^/]|^~[^/]/;
              build.onResolve({ filter }, (args) => {
                return { path: args.path, external: true };
              });
            },
          },
        ],
        minify: false,
        sourcemap: false,
        treeShaking: true,
      });
      const code = Buffer.from(outputFiles[0].contents).toString("utf-8");
      exports = execute(code, this);
    } catch (error) {
      callback(new Error(`Unable to execute "${this.resource}": ${error}`));

      return;
    }
  }

  const func = exports && exports.default ? exports.default : exports;

  if (typeof func !== "function") {
    callback(
      new Error(
        `Module "${this.resource}" does not export a function as default`
      )
    );
    return;
  }

  let result;

  try {
    result = func(options, this, content);
  } catch (error) {
    callback(new Error(`Module "${this.resource}" throw error: ${error}`));
    return;
  }

  if (result && typeof result.then === "function") {
    result
      .then((res) => processResult(this, res))
      .catch((error) => {
        callback(new Error(`Module "${this.resource}" throw error: ${error}`));
      });

    return;
  }

  // No return necessary because processResult calls this.callback()
  processResult(this, result);
}
