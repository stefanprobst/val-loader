import type { LoaderDefinitionFunction } from 'webpack'

/**
 * @see https://github.com/stefanprobst/val-loader#return-object-properties
 */
 export interface ValLoaderResult {
  code: string | Buffer
  sourceMap?: object
  ast?: Array<object>
  dependencies?: Array<string>
  contextDependencies?: Array<string>
  buildDependencies?: Array<string>
  /** @default false */
  cacheable?: boolean
}

declare const loader: LoaderDefinitionFunction

export default loader
