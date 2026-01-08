import OpenAI from 'openai';

const SYSTEM_PROMPT = `You are a technical project planner. Given a feature idea, break it down into clear, actionable milestones. Each milestone should be:
- Specific and achievable
- Ordered logically (dependencies considered)
- Scoped appropriately (not too broad, not too granular)

Return your response as a JSON object with a "milestones" array:
{
  "milestones": [
    { "title": "Milestone title", "description": "Brief description of what this milestone achieves" },
    ...
  ]
}

Aim for 3-7 milestones depending on feature complexity. Focus on implementation steps that a developer can follow.`;

export async function POST(request: Request) {
  try {
    const { featureIdea, openaiApiKey } = await request.json();

    if (!featureIdea) {
      return new Response(
        JSON.stringify({ error: 'featureIdea is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: 'openaiApiKey is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const openai = new OpenAI({ apiKey: openaiApiKey });

    const stream = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Feature idea: ${featureIdea}` },
      ],
      stream: true,
      response_format: { type: 'json_object' },
    });

    // Create streaming response using SSE
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in milestone planning:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate plan';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
