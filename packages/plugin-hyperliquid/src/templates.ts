export const spotTradeTemplate = `<task>
Look at your LAST RESPONSE in the conversation where you confirmed a trade request.
Based on ONLY that last message, extract the trading details.
</task>

<context>
Recent conversation:
{{recentMessages}}
</context>

<rules>
For Hyperliquid spot trading:

Market orders (executes immediately at best available price):
- "buy 1 HYPE" -> coin: HYPE, is_buy: true, sz: 1
- "sell 2 HYPE" -> coin: HYPE, is_buy: false, sz: 2
- "market buy 1 HYPE" -> coin: HYPE, is_buy: true, sz: 1
- "market sell 2 HYPE" -> coin: HYPE, is_buy: false, sz: 2

Limit orders (waits for specified price):
- "buy 1 HYPE at 20 USDC" -> coin: HYPE, is_buy: true, sz: 1, limit_px: 20
- "sell 0.5 HYPE at 21 USDC" -> coin: HYPE, is_buy: false, sz: 0.5, limit_px: 21
- "limit buy 1 HYPE at 20 USDC" -> coin: HYPE, is_buy: true, sz: 1, limit_px: 20
- "limit sell 0.5 HYPE at 21 USDC" -> coin: HYPE, is_buy: false, sz: 0.5, limit_px: 21
</rules>

<instructions>
1. Extract the coin symbol (HYPE, ETH, etc.) - just the symbol, no suffixes
2. Determine if it's a buy (true) or sell (false) order
3. Extract the size/quantity (sz) to trade as specified in the message
4. Extract limit_px only if a price was specified with "at X USDC", otherwise set to null for market orders
5. Words like "market" or "limit" at the start are optional but help clarify intent
</instructions>

Respond with an XML block containing only the extracted values. Use key-value pairs.

Example response for a market buy:
<response>
    <coin>HYPE</coin>
    <is_buy>true</is_buy>
    <sz>1</sz>
    <limit_px>null</limit_px>
</response>

Example response for a limit sell:
<response>
    <coin>HYPE</coin>
    <is_buy>false</is_buy>
    <sz>0.5</sz>
    <limit_px>21</limit_px>
</response>`;

export const priceCheckTemplate = `<task>
Look at your LAST RESPONSE in the conversation where you confirmed which token price to check.
Based on ONLY that last message, extract the token symbol.
</task>

<context>
Recent conversation:
{{recentMessages}}
</context>

<examples>
- "I'll check PIP price for you" -> symbol: PIP
- "Let me check the price of HYPE" -> symbol: HYPE
- "I'll get the current ETH price" -> symbol: ETH
</examples>

<instructions>
1. Extract the token symbol from your last message
2. Return just the token symbol (PIP, HYPE, ETH, etc.)
3. Remove any suffixes like "-SPOT" or "USDC"
4. If multiple tokens are mentioned, use the last one
</instructions>

Respond with an XML block containing only the extracted value.

Example response:
<response>
    <symbol>HYPE</symbol>
</response>`;
