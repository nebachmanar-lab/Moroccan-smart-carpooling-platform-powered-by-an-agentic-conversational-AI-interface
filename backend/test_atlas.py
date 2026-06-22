from huggingface_hub import InferenceClient

# Atlas-Chat-9B is not available on HF serverless inference.
# Qwen2.5-72B has strong Arabic/Darija support and IS available.
client = InferenceClient(
    provider="novita",
    model="Qwen/Qwen2.5-72B-Instruct",
    token="<HF_TOKEN>"  # set via HF_TOKEN env variable
)

response = client.chat_completion(
    messages=[{
        "role": "user",
        "content": "ترجم لي هاد الجملة للفرنسية: بغيت نمشي من كازا لمراكش غدا"
    }],
    max_tokens=200
)

print(response.choices[0].message.content)
