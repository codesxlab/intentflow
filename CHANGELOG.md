# Changelog

## 0.2.0

- **Missing or made-up details become `none`.** After the schema check, `createIntentFlow` runs `checkDetails`: a required (non-nullable) text field that is empty or a placeholder (`"later"`, `"TBD"`, `"null"`, `"später"`, `"belirtilmedi"`, …) and a `grounded` field whose value does not appear in the request turn the proposal into `none` with a reason. Opt out with `checkDetails: false`.
- `defineAction` accepts `grounded`: fields whose values must come from the request. The example catalog grounds `send_email.to`.
- The system prompt asks the model to return `none` when a detail the action needs is missing, instead of guessing.
- Example catalog: `send_email.body` is now nullable, since a request may give no message (e.g. "Email the invoice summary to finance@…").
- Measured offline by replaying the 71 recorded gpt-6-astra outputs: the six missing-detail failures become `none`, and none of the 65 correct proposals is rejected. A live re-run is still pending.
- Evals: `--replay <report>` replays recorded outputs without API calls; `--no-check-details` turns the checks off.

## 0.1.0

First release on npm as `@codesxlab/intentflow`.

- `createIntentFlow`, `ApprovalQueue`, providers for the OpenAI and Claude APIs, and a key-free mock provider.
- Token usage reporting through `onUsage`.
- Eval suite of 71 requests in English, Turkish, and German, with results per language and the tokens used.
