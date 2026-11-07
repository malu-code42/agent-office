// AO-109, parte 3: a ferramenta `merge_pr` do escritório. Existe SÓ para agentes de nível 5 (sdk.ts a monta só nele; o cartão
// de decisions.ts nega em qualquer outro nível) e o terminal segue negado pelo piso.
//
// Nada de argumento livre: o agente informa só o número do PR. A execução só acontece com uma aprovação gravada pelo cartão
// reforçado (repositório, PR, branch, commit e "você pediu este merge?"), uma por uso: sem aprovação, a ferramenta recusa.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

export const MERGE_SERVER = 'merge'
export const MERGE_TOOL = `mcp__${MERGE_SERVER}__merge_pr`

/** Aprovações do cartão, de uso único: `agente:PR` → commit que a usuária viu. Expiram em 10 minutos. */
export class MergeApprovals {
  private readonly granted = new Map<string, { sha: string; at: number }>()
  constructor(private readonly now: () => number = Date.now) {}

  grant(agentId: string, pr: number, sha: string): void {
    this.granted.set(`${agentId}:${pr}`, { sha, at: this.now() })
  }

  /** Devolve o commit aprovado e apaga a aprovação (uso único). */
  take(agentId: string, pr: number): string | undefined {
    const key = `${agentId}:${pr}`
    const found = this.granted.get(key)
    this.granted.delete(key)
    return found && this.now() - found.at < 10 * 60_000 ? found.sha : undefined
  }
}

export interface MergeToolDeps {
  agentId: string
  approvals: MergeApprovals
  /** Mescla o PR na pasta do agente; lança erro se algo não bater. */
  merge(pr: number, sha: string): Promise<string>
}

export function createMergeTools(deps: MergeToolDeps): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: MERGE_SERVER,
    version: '1.0.0',
    instructions:
      'Mescla um pull request do repositório desta pasta. Só use quando a usuária pediu esse merge na conversa. ' +
      'Informe apenas o número do PR; a usuária confirma num cartão a cada uso.',
    tools: [
      tool(
        'merge_pr',
        'Mescla um pull request aberto deste repositório (merge commit). Exige o cartão de confirmação da usuária a cada uso.',
        { pr: z.number().int().positive().describe('Número do PR neste repositório') },
        async (args) => {
          try {
            const sha = deps.approvals.take(deps.agentId, args.pr)
            if (!sha) throw new Error('Sem a confirmação da usuária neste cartão; nada foi mesclado.')
            const url = await deps.merge(args.pr, sha)
            return { content: [{ type: 'text' as const, text: `PR #${args.pr} mesclado: ${url}` }] }
          } catch (err) {
            return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
          }
        },
      ),
    ],
  })
}
