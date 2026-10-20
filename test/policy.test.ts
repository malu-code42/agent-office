import { describe, expect, it } from 'vitest'
import { decide, type AlwaysAllowRule, type PolicyScope } from '../src/main/permissions/policy'

// O escritório é a autoridade de permissões (o CLI só obedece). A matriz pura: modo ×
// ferramenta × caminho. Aqui não há Electron nem SDK: `decide` responde allow (roda sem
// perguntar) ou ask (mostra o cartão). Categorias que o ticket fixou: apagar arquivos,
// instalar dependências, rede externa, commit/push/PR/publicar SEMPRE pedem confirmação
// no Automático, mesmo com "Sempre permitir".

const rule = (kind: 'tool' | 'command', value: string): AlwaysAllowRule => ({ id: `r-${value}`, kind, value, createdAt: 1 })
const WIN = { cwd: 'D:\\dados\\proj' } satisfies PolicyScope
const POSIX = { cwd: '/Users/x/proj' } satisfies PolicyScope

describe('modo Automático (auto): arquivos', () => {
  it('leitura e edição dentro da pasta passam sem pedir (Windows e POSIX)', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\dados\\proj\\src\\a.ts' }, WIN)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Edit', { file_path: 'D:\\dados\\proj\\src\\a.ts' }, WIN)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Write', { file_path: 'D:\\dados\\proj\\README.md' }, WIN)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Glob', { pattern: 'src/**/*.ts' }, WIN)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Read', { file_path: '/Users/x/proj/src/a.ts' }, POSIX)).toEqual({ verdict: 'allow' })
  })

  it('a própria pasta não é arquivo: escrever nela pede', () => {
    expect(decide('auto', 'Write', { file_path: 'D:\\dados\\proj' }, WIN).verdict).toBe('ask')
  })

  it('escrita resolvida para fora (ou escrita em arquivo que roda código) pede', () => {
    const cases: [string, string][] = [
      ['fora', 'D:\\dados\\outro\\a.md'],
      ['prefixo irmão (Windows)', 'D:\\dados\\proj-evil\\a.md'],
      ['prefixo irmão (POSIX)', '/Users/x/proj-evil/a.md'],
      ['subir com ..', '/Users/x/proj/../outro/a.md'],
      ['relativo', 'src/a.ts'],
      ['til', '~/proj/a.md'],
      ['guia (UNC)', '\\\\server\\share\\a.md'],
      ['UNC de guias', '//server/share/a.md'],
      ['drive-relativo', 'D:proj\\a.md'],
      ['controle', 'D:\\dados\\proj\\a\n.md'],
      ['package.json', 'D:\\dados\\proj\\package.json'],
      ['config que roda código', '/Users/x/proj/vite.config.ts'],
      ['script', 'D:\\dados\\proj\\build.sh'],
      ['.env', 'D:\\dados\\proj\\.env'],
      ['.git', 'D:\\dados\\proj\\.git\\hooks\\x'],
    ]
    for (const [label, file] of cases) expect(decide('auto', 'Write', { file_path: file }, WIN).verdict, label).toBe('ask')
  })

  it('ler em arquivo que roda código continua passando', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\dados\\proj\\package.json' }, WIN)).toEqual({ verdict: 'allow' })
  })

  it('fora da pasta, até ler pede', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\dados\\outro\\a.txt' }, WIN)).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
  })
})

describe('modo Automático (auto): comandos', () => {
  it('testes e build passam', () => {
    for (const c of ['npm test', 'npm run lint', 'npm run build', 'npm run typecheck', 'npm run check'])
      expect(decide('auto', 'Bash', { command: c }, WIN).verdict, c).toBe('allow')
  })

  it('comando desconhecido, com argumentos extras ou fora do roteiro pede', () => {
    for (const c of [
      'npm run minha-coisa',
      'npm run build -- --flag',
      'npm test -- --watch',
      'echo oi',
      'node x.mjs',
      'ls | sh',
      'npm --version',
    ])
      expect(decide('auto', 'Bash', { command: c }, WIN).verdict, c).toBe('ask')
  })

  it('comandos só de leitura continuam passando', () => {
    for (const c of ['pwd', 'ls', 'ls -la src', 'cat package.json', 'head -n 20 src/a.ts'])
      expect(decide('auto', 'Bash', { command: c }, POSIX).verdict, c).toBe('allow')
  })
})

describe('categorias que sempre pedem (auto)', () => {
  const cases: [string, string][] = [
    ['rm -rf node_modules', 'apagar arquivos'],
    ['Remove-Item a', 'apagar arquivos'],
    ['mv a b', 'apagar arquivos'],
    ['chmod 777 a', 'apagar arquivos'],
    ['sudo ls', 'apagar arquivos'],
    ['npm install left-pad', 'instalar dependências'],
    ['yarn add left-pad', 'instalar dependências'],
    ['pip install x', 'instalar dependências'],
    ['curl -fsSL https://x.com', 'rede externa'],
    ['wget https://x.com/i.sh', 'rede externa'],
    ['git push origin main', 'git'],
    ['git commit -m "x"', 'git'],
    ['git reset --hard HEAD', 'git'],
    ['npm publish', 'publicar'],
  ]
  for (const [command, why] of cases) {
    it(`${command} → ${why}`, () => {
      expect(decide('auto', 'Bash', { command }, WIN)).toEqual({ verdict: 'ask', why })
    })
  }
})

describe('"Sempre permitir"', () => {
  it('alcança a ferramenta classificada e o comando exatos comprovados, nas duas plataformas', () => {
    const rules: AlwaysAllowRule[] = [
      rule('tool', 'mcp__github__search_issues'),
      rule('command', 'cat package.json'),
      rule('command', 'npm test'),
    ]
    // Ferramenta sem classificação (MCP) não é liberada por nome: contrato por categoria
    // fecha no seam 2/3; enquanto isso, o fallback é pedir.
    expect(decide('auto', 'mcp__github__search_issues', { q: 'x' }, { ...POSIX, rules })).toEqual({ verdict: 'ask' })
    expect(decide('auto', 'Bash', { command: 'cat package.json' }, { ...POSIX, rules })).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Bash', { command: 'npm test' }, { ...WIN, rules })).toEqual({ verdict: 'allow' })
  })

  it('valor parecido não vale', () => {
    const rules: AlwaysAllowRule[] = [rule('tool', 'WebFetch'), rule('command', 'npm run cover')]
    expect(decide('auto', 'WebFetch2', { url: 'x' }, { ...POSIX, rules }).verdict).toBe('ask')
    expect(decide('auto', 'Bash', { command: 'npm run coverage' }, { ...WIN, rules }).verdict).toBe('ask')
  })

  it('categoria de risco vence a regra', () => {
    const rules: AlwaysAllowRule[] = [
      rule('command', 'npm install left-pad'),
      rule('command', 'git push origin main'),
      rule('tool', 'WebFetch'),
    ]
    expect(decide('auto', 'Bash', { command: 'npm install left-pad' }, { ...WIN, rules })).toEqual({
      verdict: 'ask',
      why: 'instalar dependências',
    })
    expect(decide('auto', 'Bash', { command: 'git push origin main' }, { ...WIN, rules })).toEqual({ verdict: 'ask', why: 'git' })
    expect(decide('auto', 'WebFetch', { url: 'https://x.com' }, { ...POSIX, rules })).toEqual({ verdict: 'ask', why: 'rede externa' })
  })
})

describe('"Sempre permitir" só confirma o que a classificação provou seguro — juiz, achado do bypass de comando', () => {
  it('desconhecido com efeito fora do projeto pede, com regra exata salvada', () => {
    for (const mode of ['auto', 'acceptEdits', 'default'] as const) {
      expect(
        decide(mode, 'Bash', { command: 'cp a /outro/file' }, { ...POSIX, rules: [rule('command', 'cp a /outro/file')] }).verdict,
        `${mode} · cp POSIX`,
      ).toBe('ask')
      expect(
        decide(mode, 'Bash', { command: 'touch .env' }, { ...POSIX, rules: [rule('command', 'touch .env')] }).verdict,
        `${mode} · touch`,
      ).toBe('ask')
      expect(
        decide(mode, 'Bash', { command: 'cp a D:/outside/file' }, { ...WIN, rules: [rule('command', 'cp a D:/outside/file')] }).verdict,
        `${mode} · cp Windows`,
      ).toBe('ask')
    }
  })

  it('script desconhecido do package.json pede, com regra exata salvada', () => {
    for (const mode of ['auto', 'acceptEdits', 'default'] as const) {
      expect(
        decide(mode, 'Bash', { command: 'npm run cover' }, { ...WIN, rules: [rule('command', 'npm run cover')] }).verdict,
        `${mode} · npm run cover`,
      ).toBe('ask')
    }
  })

  it('interpretador por caminho e variante é executar programa, em todo modo', () => {
    expect(
      decide(
        'auto',
        'Bash',
        { command: 'cmd.exe /c del /outro/file' },
        { ...POSIX, rules: [rule('command', 'cmd.exe /c del /outro/file')] },
      ),
    ).toEqual({ verdict: 'ask', why: 'executar programa' })
    expect(
      decide('default', 'Bash', { command: '/usr/bin/python x.py' }, { ...POSIX, rules: [rule('command', '/usr/bin/python x.py')] }),
    ).toEqual({ verdict: 'ask', why: 'executar programa' })
  })

  it('e a regra ainda confirma o comprovado: leitura da lista e scripts fechados do package', () => {
    expect(
      decide('acceptEdits', 'Bash', { command: 'cat package.json' }, { ...POSIX, rules: [rule('command', 'cat package.json')] }),
    ).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Bash', { command: 'npm run build' }, { ...WIN, rules: [rule('command', 'npm run build')] })).toEqual({
      verdict: 'allow',
    })
  })
})

describe('"Sempre permitir" não vai além do já seguro (juiz, ticket 03)', () => {
  it('regra da ferramenta Write não libera arquivo sensível nem fora da pasta', () => {
    const regraWrite = [rule('tool', 'Write')]
    expect(decide('auto', 'Write', { file_path: 'D:\\proj\\.env' }, { cwd: 'D:\\proj', rules: regraWrite })).toEqual({ verdict: 'ask' })
    expect(decide('auto', 'Write', { file_path: 'D:\\outside\\x.ts' }, { cwd: 'D:\\proj', rules: regraWrite })).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
    for (const mode of ['acceptEdits', 'default'] as const) {
      expect(decide(mode, 'Write', { file_path: 'D:\\proj\\.env' }, { cwd: 'D:\\proj', rules: regraWrite }).verdict, mode).toBe('ask')
    }
  })

  it('a regra continua alcançando a escrita in-scope segura no modo que só por ela pergunta', () => {
    const regraWrite = [rule('tool', 'Write')]
    expect(decide('default', 'Write', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj', rules: regraWrite })).toEqual({
      verdict: 'allow',
    })
    expect(decide('default', 'Write', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'ask' })
    expect(decide('default', 'Read', { file_path: 'D:\\proj\\README.md' }, { cwd: 'D:\\proj', rules: [rule('tool', 'Read')] })).toEqual({
      verdict: 'allow',
    })
  })

  it('regras de comando envolvidos (casca e interpretador) não rodam, em nenhum modo', () => {
    const regras: AlwaysAllowRule[] = [
      rule('command', "bash -c 'rm -rf /dados/x'"),
      rule('command', 'bash -c ls'),
      rule('command', 'cmd /c del D:\\x.txt'),
      rule('command', 'git -C D:\\out push'),
      rule('command', 'npm --prefix D:\\out install left-pad'),
      rule('command', 'node script.js'),
    ]
    const scope = { cwd: 'D:\\proj', rules: regras } satisfies PolicyScope
    for (const mode of ['auto', 'default', 'acceptEdits'] as const)
      for (const r of regras) expect(decide(mode, 'Bash', { command: r.value }, scope).verdict, `${mode} · ${r.value}`).toBe('ask')
  })

  it('flags deslocando a ação perigosa: git -C push e npm --prefix install pedem, com a categoria', () => {
    const git = 'git -C ../out push'
    const npm = 'npm --prefix test install left-pad'
    const regras: AlwaysAllowRule[] = [rule('command', git), rule('command', npm)]
    expect(decide('auto', 'Bash', { command: git }, { ...POSIX, rules: regras })).toEqual({ verdict: 'ask', why: 'git' })
    expect(decide('auto', 'Bash', { command: npm }, { ...POSIX, rules: regras })).toEqual({ verdict: 'ask', why: 'instalar dependências' })
  })

  it('regra da ferramenta Bash não libera comando: só kind command alcança o Bash', () => {
    const regraBash = [rule('tool', 'Bash')]
    expect(decide('default', 'Bash', { command: 'node x.mjs' }, { cwd: 'D:\\proj', rules: regraBash })).toEqual({
      verdict: 'ask',
      why: 'executar programa',
    })
    expect(decide('default', 'Bash', { command: 'ls' }, { cwd: 'D:\\proj', rules: regraBash })).toEqual({ verdict: 'ask' })
  })

  it('regra de comando salva continua liberando a ação segura que só por ela passa', () => {
    const regras: AlwaysAllowRule[] = [rule('command', 'ls -la src'), rule('command', 'npm run build')]
    expect(decide('default', 'Bash', { command: 'ls -la src' }, { ...POSIX, rules: regras })).toEqual({ verdict: 'allow' })
    expect(decide('acceptEdits', 'Bash', { command: 'npm run build' }, { ...WIN, rules: regras })).toEqual({ verdict: 'allow' })
  })
})

describe('caminhos do Windows', () => {
  it('maiúscula/minúscula no disco do Windows: sem realpath, pede; com realpath, passa', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\DADOS\\proj\\src\\a.ts' }, WIN).verdict).toBe('ask')
    expect(
      decide('auto', 'Read', { file_path: 'D:\\DADOS\\proj\\src\\a.ts' }, { cwd: 'D:\\dados\\proj', realpath: (p) => p.toLowerCase() }),
    ).toEqual({ verdict: 'allow' })
  })

  it('.. resolvido continua dentro da pasta', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\dados\\proj\\sub\\..\\a.ts' }, WIN)).toEqual({ verdict: 'allow' })
  })

  it('realpath que revela fora do projeto pede (symlink)', () => {
    const REAL = '/Users/x/root'
    const abs: PolicyScope = {
      cwd: `${REAL}/proj`,
      // O Windows entrega caminho com \: o fake bate nele com os dois separadores.
      realpath: (p) => {
        const flat = p.replace(/\\/g, '/')
        if (/leia\.txt$/.test(flat)) return `${REAL}/fora/segredo.txt`
        if (/\/atalho/.test(flat)) return `${REAL}/fora`
        return p
      },
    }
    expect(decide('auto', 'Read', { file_path: `${REAL}/proj/leia.txt` }, abs).verdict).toBe('ask')
    expect(decide('auto', 'Write', { file_path: `${REAL}/proj/atalho/novo.ts` }, abs).verdict).toBe('ask')
    expect(decide('auto', 'Write', { file_path: `${REAL}/proj/src/novo.ts` }, abs).verdict).toBe('allow')
  })

  it('realpath que quebra deixa sem decisão automática', () => {
    const abs: PolicyScope = {
      cwd: '/Users/x/proj',
      realpath: () => {
        throw new Error('ENOENT')
      },
    }
    expect(decide('auto', 'Write', { file_path: '/Users/x/proj/novo.ts' }, abs).verdict).toBe('ask')
  })
})

describe('modos outros', () => {
  it('Sem pedir (bypassPermissions) passa tudo: o consentimento veio na escolha do modo', () => {
    const p: PolicyScope = { cwd: 'D:\\proj' }
    expect(decide('bypassPermissions', 'Bash', { command: 'rm -rf /' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('bypassPermissions', 'Bash', { command: 'git push --force' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('bypassPermissions', 'Write', { file_path: 'D:\\proj\\.env' }, p)).toEqual({ verdict: 'allow' })
  })

  it('Planejar: leitura comum in-scope passa; fora, sensível e escrever pedem', () => {
    expect(decide('plan', 'Read', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'allow' })
    expect(decide('plan', 'Read', { file_path: 'D:\\proj\\.env' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
    expect(decide('plan', 'Read', { file_path: 'D:\\outside\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
    expect(decide('plan', 'Write', { file_path: 'D:\\proj\\a.md' }, { cwd: 'D:\\proj' }).verdict).toBe('ask')
    expect(decide('plan', 'Bash', { command: 'cat package.json' }, { cwd: '/Users/x/proj' })).toEqual({ verdict: 'allow' })
    expect(decide('plan', 'Bash', { command: 'npm test' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'ask', why: 'Planejar só lê' })
  })

  it('Pedir permissão (default): só a regra salva; o resto pede', () => {
    expect(decide('default', 'Edit', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'ask' })
    expect(decide('default', 'Bash', { command: 'npm test' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'ask' })
  })

  it('Aceitar edições: edição in-scope passa, comando pede', () => {
    expect(decide('acceptEdits', 'Edit', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'allow' })
    expect(decide('acceptEdits', 'Bash', { command: 'npm test' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'ask' })
  })

  it('modo desconhecido é tratado como Pedir permissão (que lê in-scope comum)', () => {
    expect(decide('desconhecido' as 'default', 'Edit', { file_path: '/p/a.ts' }, { cwd: '/p' })).toEqual({ verdict: 'ask' })
    expect(decide('desconhecido' as 'default', 'Read', { file_path: '/p/a.ts' }, { cwd: '/p' })).toEqual({ verdict: 'allow' })
  })
})

describe('leitura sensível nunca passa (exceto Sem pedir) — juiz, achado 2', () => {
  const p = { cwd: 'D:\\proj' }

  it('Automático e Aceitar edições não mandam segredo ao modelo: .env e .claude pedem', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\proj\\.env' }, p)).toEqual({ verdict: 'ask', why: 'arquivo sensível' })
    expect(decide('auto', 'Read', { file_path: 'D:\\proj\\.claude\\settings.json' }, p)).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
    expect(decide('acceptEdits', 'Read', { file_path: 'D:\\proj\\.env' }, p)).toEqual({ verdict: 'ask', why: 'arquivo sensível' })
    expect(decide('default', 'Read', { file_path: 'D:\\proj\\.env' }, p)).toEqual({ verdict: 'ask', why: 'arquivo sensível' })
  })

  it('Grep e Glob não vasculham segredo: caminho e padrão sensíveis pedem', () => {
    expect(decide('auto', 'Grep', { pattern: 'chave', path: 'D:\\proj\\.env' }, p)).toEqual({ verdict: 'ask', why: 'arquivo sensível' })
    expect(decide('auto', 'Glob', { pattern: '.env*' }, p)).toEqual({ verdict: 'ask', why: 'arquivo sensível' })
  })

  it('a regra salva não libera o sensível, e "Sem pedir" continua a única exceção', () => {
    const regras = [rule('tool', 'Read'), rule('tool', 'Grep')]
    expect(decide('auto', 'Read', { file_path: 'D:\\proj\\.env' }, { ...p, rules: regras }).verdict).toBe('ask')
    expect(decide('bypassPermissions', 'Read', { file_path: 'D:\\proj\\.env' }, p)).toEqual({ verdict: 'allow' })
  })

  it('guarda: leitura comum do projeto segue passando', () => {
    expect(decide('auto', 'Read', { file_path: 'D:\\proj\\src\\a.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Grep', { pattern: 'chave', path: 'D:\\proj\\src\\a.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Grep', { pattern: 'chave', path: 'D:\\proj\\src', glob: '*.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Grep', { pattern: 'chave', path: 'D:\\proj\\src' }, p)).toEqual({ verdict: 'ask', why: 'busca larga' })
    expect(decide('auto', 'Glob', { pattern: 'src/**/*.ts' }, p)).toEqual({ verdict: 'allow' })
  })
})

describe('Planejar só lê o lugar anunciado — juiz, achado 1', () => {
  it('fora da pasta pede, mesmo sendo leitura banal', () => {
    expect(decide('plan', 'Read', { file_path: 'D:\\outside\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
    expect(decide('plan', 'Read', { file_path: '\\\\servidor\\compart\\a.ts' }, { cwd: 'D:\\proj' }).verdict).toBe('ask')
  })

  it('caminho ambíguo (~/, sem caminho, caracteres de controle) pede', () => {
    expect(decide('plan', 'Read', { file_path: '~/.ssh/id_rsa' }, { cwd: 'D:\\proj' }).verdict).toBe('ask')
    expect(decide('plan', 'Read', {}, { cwd: 'D:\\proj' }).verdict).toBe('ask')
    expect(decide('plan', 'Read', { file_path: 'D:\\proj\\a\nb.md' }, { cwd: 'D:\\proj' }).verdict).toBe('ask')
  })

  it('symlink que sai da pasta pede (o julgamento é do arquivo de verdade)', () => {
    const scope: PolicyScope = {
      cwd: '/root/proj',
      realpath: (p) => (/leia\.txt$/.test(p) ? '/root/fora/.env' : p),
    }
    expect(decide('plan', 'Read', { file_path: '/root/proj/leia.txt' }, scope)).toEqual({ verdict: 'ask', why: 'fora da pasta do projeto' })
  })

  it('sensível pede em Planejar e escrever/comando que muda seguem pedindo', () => {
    expect(decide('plan', 'Read', { file_path: 'D:\\proj\\.env' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
    expect(decide('plan', 'Write', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'Planejar só lê',
    })
  })
})

describe('Pedir permissão lê o projeto comum; editar e comandos pedem — juiz, achado 4', () => {
  it('leitura comum in-scope não pergunta (a UI anuncia pedir só para editar/rodar)', () => {
    expect(decide('default', 'Read', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Glob', { pattern: 'src/**/*.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Grep', { pattern: 'x', path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'allow' })
  })

  it('fora e sensível pedem do mesmo jeito', () => {
    expect(decide('default', 'Read', { file_path: 'D:\\outside\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
    expect(decide('default', 'Read', { file_path: 'D:\\proj\\.env' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
  })

  it('e Planejar sincroniza: lê comum in-scope, sem editar nem comando que muda', () => {
    expect(decide('plan', 'Read', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({ verdict: 'allow' })
    expect(decide('plan', 'Edit', { file_path: 'D:\\proj\\src\\a.ts' }, { cwd: 'D:\\proj' })).toEqual({
      verdict: 'ask',
      why: 'Planejar só lê',
    })
    expect(decide('plan', 'Bash', { command: 'cat package.json' }, { cwd: '/Users/x/proj' })).toEqual({ verdict: 'allow' })
  })
})

describe('ferramenta desconhecida (MCP): regra não libera o nome — juiz, achado 3', () => {
  it('action sem classificação segura pede, com ou sem regra salva', () => {
    const regras = [rule('tool', 'mcp__servidor__publicar'), rule('tool', 'Task')]
    for (const mode of ['auto', 'default', 'acceptEdits'] as const) {
      expect(decide(mode, 'mcp__servidor__publicar', { destino: 'x' }, { cwd: 'D:\\proj', rules: regras }).verdict, mode).toBe('ask')
      expect(decide(mode, 'Task', {}, { cwd: 'D:\\proj', rules: regras }).verdict, `${mode} · Task`).toBe('ask')
    }
  })

  it('e nenhuma regra vale para ferramenta parecida', () => {
    const regras = [rule('tool', 'Write')]
    expect(decide('auto', 'WriteTool', {}, { cwd: 'D:\\proj', rules: regras })).toEqual({ verdict: 'ask' })
  })
})

describe('busca de conteúdo (Grep) fechada no lugar anunciado — decisão da usuária, ticket 03', () => {
  const p = { cwd: 'D:\\proj' }

  it('sem path pede (busca larga), em todo modo de trabalho; "Sem pedir" é a única exceção', () => {
    for (const mode of ['auto', 'default', 'acceptEdits', 'plan'] as const) {
      expect(decide(mode, 'Grep', { pattern: 'x' }, p), mode).toEqual({ verdict: 'ask', why: 'busca larga' })
    }
    expect(decide('bypassPermissions', 'Grep', { pattern: 'x' }, p)).toEqual({ verdict: 'allow' })
  })

  it('diretório (raiz ou subpasta) sem filtro pede; com filtro provável comum passa', () => {
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src' }, p)).toEqual({ verdict: 'ask', why: 'busca larga' })
    expect(decide('default', 'Grep', { pattern: 'x', path: 'D:\\proj' }, p)).toEqual({ verdict: 'ask', why: 'busca larga' })
    expect(decide('plan', 'Grep', { pattern: 'x', path: 'D:\\proj\\src' }, p)).toEqual({ verdict: 'ask', why: 'busca larga' })
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '*.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Grep', { pattern: 'x', path: 'D:\\proj', glob: '*.md' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('plan', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '*.ts' }, p)).toEqual({ verdict: 'allow' })
  })

  it('arquivo comum explícito passa em Automático e Pedir permissão', () => {
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\package.json' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Grep', { pattern: 'x', path: 'D:\\proj\\src\\a.ts' }, p)).toEqual({ verdict: 'allow' })
  })

  it('sensível, fora e symlink pedem mesmo com regra salvada', () => {
    const regras = [rule('tool', 'Grep')]
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\.env' }, { ...p, rules: regras })).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\outro\\a.ts' }, { ...p, rules: regras })).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
    const escopo: PolicyScope = {
      cwd: '/root/proj',
      realpath: (caminho) => (/leia\.txt$/.test(caminho) ? '/root/fora/.env' : caminho),
      rules: regras,
    }
    expect(decide('auto', 'Grep', { pattern: 'x', path: '/root/proj/leia.txt' }, escopo).verdict).toBe('ask')
  })

  it('filtro que não prova limite para arquivos comuns pede', () => {
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '.env*' }, p)).toEqual({
      verdict: 'ask',
      why: 'busca larga',
    })
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '**/*.ts' }, p)).toEqual({
      verdict: 'ask',
      why: 'busca larga',
    })
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '../../x/*.ts' }, p)).toEqual({
      verdict: 'ask',
      why: 'busca larga',
    })
  })

  it('filtro sensível ou fora da allowlist de extensões comuns pede — juiz: glob não é caminho', () => {
    // glob é PADRÃO, não caminho: sensitivePath() não o valida — o "*" esconde de
    // SENSITIVE_WORDS o ".env"/"credentials"/"pem"; e "qualquer extensão" alcança segredo.
    for (const filtro of ['*.env', '*.credentials', '*.pem', '*.dat']) {
      expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: filtro }, p), filtro).toEqual({
        verdict: 'ask',
        why: 'busca larga',
      })
    }
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: 'src/*.ts' }, p)).toEqual({
      verdict: 'ask',
      why: 'busca larga',
    })
  })

  it('allowlist: filtro "*.ext" comum de código/docs deste projeto passa', () => {
    for (const filtro of ['*.ts', '*.tsx', '*.mjs', '*.css', '*.html', '*.md']) {
      expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: filtro }, p), filtro).toEqual({ verdict: 'allow' })
    }
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj', glob: '*.md' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '*.TS' }, p)).toEqual({ verdict: 'allow' })
  })
})

describe('busca de nomes (Glob) limitada ao lugar anunciado — juiz, achado do path sem validação', () => {
  const p = { cwd: 'D:\\proj' }

  it('path fora do escopo pede, em todo modo de trabalho e mesmo com regra salvada', () => {
    for (const mode of ['auto', 'acceptEdits', 'default', 'plan'] as const) {
      expect(decide(mode, 'Glob', { path: 'D:\\outside', pattern: '*.ts' }, p), mode).toEqual({
        verdict: 'ask',
        why: 'fora da pasta do projeto',
      })
    }
    expect(decide('auto', 'Glob', { path: 'D:\\outside', pattern: '*.ts' }, { ...p, rules: [rule('tool', 'Glob')] })).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
  })

  it('symlink que sai da pasta pede (o lugar é o projeto de verdade)', () => {
    const escopo: PolicyScope = {
      cwd: '/root/proj',
      // O Windows entrega caminho com \: o fake bate nele com os dois separadores.
      realpath: (caminho) => (/\/atalho$/.test(caminho.replace(/\\/g, '/')) ? '/root/fora' : caminho),
    }
    expect(decide('auto', 'Glob', { path: '/root/proj/atalho', pattern: '*.ts' }, escopo)).toEqual({
      verdict: 'ask',
      why: 'fora da pasta do projeto',
    })
  })

  it('sem path e sem pasta do agente pede; relativo e estranho pedem do mesmo jeito', () => {
    expect(decide('auto', 'Glob', { pattern: '*.ts' }, {})).toEqual({ verdict: 'ask', why: 'sem a pasta do agente' })
    expect(decide('plan', 'Glob', { pattern: '*.ts' }, {})).toEqual({ verdict: 'ask', why: 'sem a pasta do agente' })
    expect(decide('auto', 'Glob', { path: 'src', pattern: '*.ts' }, p).verdict).toBe('ask')
  })

  it('raiz e subpasta do projeto com padrão fechado em extensão comum passam', () => {
    expect(decide('auto', 'Glob', { path: 'D:\\proj', pattern: '*.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('default', 'Glob', { path: 'D:\\proj\\src', pattern: '*.md' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Glob', { pattern: '*.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('plan', 'Glob', { path: 'D:\\proj\\src', pattern: '*.tsx' }, p)).toEqual({ verdict: 'allow' })
  })

  it('segredo e padrão sem fundo comprovado pedem — regra salvada não vale', () => {
    const regras = [rule('tool', 'Glob')]
    expect(decide('auto', 'Glob', { path: 'D:\\proj', pattern: '**/.env' }, { ...p, rules: regras })).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
    for (const padrao of ['*', '*.*', '**/*', '*.env', '*.json']) {
      expect(decide('auto', 'Glob', { path: 'D:\\proj', pattern: padrao }, { ...p, rules: regras }), padrao).toEqual({
        verdict: 'ask',
        why: 'busca larga',
      })
    }
    // `*.pem` é capturado pela régua de extensões sensíveis: o porquê é o segredo direto.
    expect(decide('auto', 'Glob', { path: 'D:\\proj', pattern: '*.pem' }, { ...p, rules: regras })).toEqual({
      verdict: 'ask',
      why: 'arquivo sensível',
    })
    expect(decide('default', 'Glob', { pattern: '*' }, p)).toEqual({ verdict: 'ask', why: 'busca larga' })
  })

  it('guarda: Grep, Read e Glob comuns continuam como aprovado', () => {
    expect(decide('auto', 'Glob', { pattern: 'src/**/*.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Glob', { pattern: '.env*' }, p)).toEqual({ verdict: 'ask', why: 'arquivo sensível' })
    expect(decide('auto', 'Grep', { pattern: 'x', path: 'D:\\proj\\src', glob: '*.ts' }, p)).toEqual({ verdict: 'allow' })
    expect(decide('auto', 'Read', { file_path: 'D:\\proj\\src\\a.ts' }, p)).toEqual({ verdict: 'allow' })
  })
})
