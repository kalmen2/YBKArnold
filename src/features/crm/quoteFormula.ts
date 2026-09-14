// Arithmetic in quote fields, the way it works in Excel.
//
// Typing "2*4" or "=12*35.5" into a quantity or price computes it, so pricing
// per linear foot no longer means reaching for a calculator first.
//
// Deliberately NOT eval() or new Function(): quote text is saved, reloaded and
// shown to customers, and an expression evaluated that way is arbitrary code
// execution. This is a small recursive-descent parser that only ever
// understands numbers, + - * /, brackets and a leading minus.

type Token =
  | { kind: 'number', value: number }
  | { kind: 'operator', value: '+' | '-' | '*' | '/' }
  | { kind: 'paren', value: '(' | ')' }

/** True when the text is arithmetic rather than a plain number. */
export function isQuoteFormula(input: string): boolean {
  const text = String(input ?? '').trim()

  if (!text) {
    return false
  }

  if (text.startsWith('=')) {
    return true
  }

  // A bare number is not a formula, but "2*4" or "(3+1)/2" is.
  return /[+\-*/()]/.test(text.slice(1))
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  const text = input.replace(/[\s,]/g, '')
  let index = 0

  while (index < text.length) {
    const character = text[index]

    if (/[0-9.]/.test(character)) {
      let numberText = ''

      while (index < text.length && /[0-9.]/.test(text[index])) {
        numberText += text[index]
        index += 1
      }

      const value = Number(numberText)

      // "1.2.3" parses as NaN — reject rather than guess.
      if (!Number.isFinite(value)) {
        return null
      }

      tokens.push({ kind: 'number', value })
      continue
    }

    if (character === '+' || character === '-' || character === '*' || character === '/') {
      tokens.push({ kind: 'operator', value: character })
      index += 1
      continue
    }

    if (character === '(' || character === ')') {
      tokens.push({ kind: 'paren', value: character })
      index += 1
      continue
    }

    // Anything else — a letter, a stray symbol — means this is not arithmetic.
    return null
  }

  return tokens
}

/**
 * expression := term (('+' | '-') term)*
 * term       := factor (('*' | '/') factor)*
 * factor     := '-'? primary
 * primary    := number | '(' expression ')'
 */
function parse(tokens: Token[]): number | null {
  let position = 0

  const peek = () => tokens[position] ?? null

  function parseExpression(): number | null {
    let left = parseTerm()

    if (left === null) {
      return null
    }

    for (;;) {
      const token = peek()

      if (token?.kind !== 'operator' || (token.value !== '+' && token.value !== '-')) {
        return left
      }

      position += 1
      const right = parseTerm()

      if (right === null) {
        return null
      }

      left = token.value === '+' ? left + right : left - right
    }
  }

  function parseTerm(): number | null {
    let left = parseFactor()

    if (left === null) {
      return null
    }

    for (;;) {
      const token = peek()

      if (token?.kind !== 'operator' || (token.value !== '*' && token.value !== '/')) {
        return left
      }

      position += 1
      const right = parseFactor()

      if (right === null) {
        return null
      }

      // Dividing by zero gives Infinity, which is not a price.
      if (token.value === '/' && right === 0) {
        return null
      }

      left = token.value === '*' ? left * right : left / right
    }
  }

  function parseFactor(): number | null {
    const token = peek()

    if (token?.kind === 'operator' && token.value === '-') {
      position += 1
      const value = parseFactor()
      return value === null ? null : -value
    }

    if (token?.kind === 'operator' && token.value === '+') {
      position += 1
      return parseFactor()
    }

    return parsePrimary()
  }

  function parsePrimary(): number | null {
    const token = peek()

    if (token?.kind === 'number') {
      position += 1
      return token.value
    }

    if (token?.kind === 'paren' && token.value === '(') {
      position += 1
      const value = parseExpression()

      if (value === null) {
        return null
      }

      const closing = peek()

      if (closing?.kind !== 'paren' || closing.value !== ')') {
        return null
      }

      position += 1
      return value
    }

    return null
  }

  const result = parseExpression()

  // Trailing tokens mean the input was only partly understood — "2*4)" say.
  return result !== null && position === tokens.length ? result : null
}

/**
 * The number a quote field means, or null when it is not valid arithmetic.
 * Rounded to 2dp because every use of it is money or a quantity.
 */
export function evaluateQuoteFormula(input: string): number | null {
  const text = String(input ?? '').trim().replace(/^=/, '').trim()

  if (!text) {
    return null
  }

  const tokens = tokenize(text)

  if (!tokens || tokens.length === 0) {
    return null
  }

  const value = parse(tokens)

  if (value === null || !Number.isFinite(value)) {
    return null
  }

  return Number(value.toFixed(2))
}
