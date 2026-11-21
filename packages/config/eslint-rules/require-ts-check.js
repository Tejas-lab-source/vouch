// @ts-check

/** The directive every source file must start with. */
const DIRECTIVE = '// @ts-check';

/**
 * ESLint rule: the file's first line must be `// @ts-check`.
 * A shebang line, if present, may come before it.
 * @type {import('eslint').Rule.RuleModule}
 */
export const requireTsCheck = {
  meta: {
    type: 'problem',
    docs: { description: 'Require `// @ts-check` as the first line of every source file.' },
    messages: { missing: 'The first line of this file must be `// @ts-check`.' },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const lines = context.sourceCode.lines;
        const firstIndex = lines[0]?.startsWith('#!') ? 1 : 0;
        if (lines.at(firstIndex)?.trim() !== DIRECTIVE) {
          context.report({ node, loc: { line: firstIndex + 1, column: 0 }, messageId: 'missing' });
        }
      },
    };
  },
};
