import type { CodeSplittingOptions } from 'rolldown'

export const startupCodeSplitting: CodeSplittingOptions = {
  groups: [
    // main starts asynchronously without blocking evaluation of shared startup exports.
    { name: 'startup', tags: ['$initial'], priority: 10 },
    { name: 'authentication', test: /[/\\]src[/\\]AppBootstrap\.tsx$/, priority: 5 },
  ],
}
