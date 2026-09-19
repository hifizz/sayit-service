export interface JsonLlm {
  generateJson<T>(input: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
    temperature?: number;
  }): Promise<T>;
}

interface OpenAiCompatibleOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class OpenAiCompatibleLlm implements JsonLlm {
  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async generateJson<T>(input: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
    temperature?: number;
  }): Promise<T> {
    const response = await fetch(this.options.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.options.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: input.temperature ?? 0,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.schema
          }
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error('LLM error ' + response.status + ': ' + body.slice(0, 1000));
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned no content');
    return JSON.parse(content) as T;
  }
}
