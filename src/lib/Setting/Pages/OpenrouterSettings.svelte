<script lang="ts">
    import { language } from "src/lang";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    
    import { DBState } from 'src/ts/stores.svelte';
    import ChatFormatSettings from "./ChatFormatSettings.svelte";
    import OpenrouterProviderList from "src/lib/UI/OpenrouterProviderList.svelte";
    import { PlusIcon, TrashIcon } from "@lucide/svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import Help from "src/lib/Others/Help.svelte";

    const openrouterProviders = [
        // An alphabetically separate set of very-dead providers is kept at the top of the list in the docs.
        // These do not appear outside the docs: Anyscale, Cent-ML, HuggingFace ... SF Compute, Together 2, 01.AI
        // As a visual check, AI21 is the topmost provider in the sidebar of https://openrouter.ai/models, thus we want to copy from this point and below.
        "AI21",
        "AionLabs",
        "Alibaba",
        "Amazon Bedrock",
        "Anthropic",
        "AtlasCloud",
        "Atoma",
        "Avian",
        "Azure",
        "BaseTen",
        "Cerebras",
        "Chutes",
        "Cloudflare",
        "Cohere",
        "CrofAI",
        "Crusoe",
        "DeepInfra",
        "DeepSeek",
        "Enfer",
        "Featherless",
        "Fireworks",
        "Friendli",
        "GMICloud",
        "Google",
        "Google AI Studio",
        "Groq",
        "Hyperbolic",
        "Inception",
        "InferenceNet",
        "Infermatic",
        "Inflection",
        "InoCloud",
        "Kluster",
        "Lambda",
        "Liquid",
        "Mancer 2",
        "Meta",
        "Minimax",
        "Mistral",
        "Moonshot AI",
        "Morph",
        "NCompass",
        "Nebius",
        "NextBit",
        "Nineteen",
        "Novita",
        "Nvidia",
        "OpenAI",
        "OpenInference",
        "Parasail",
        "Perplexity",
        "Phala",
        "SambaNova",
        "SiliconFlow",
        "Stealth",
        "Switchpoint",
        "Targon",
        "Together",
        "Ubicloud",
        "Venice",
        "WandB",
        "xAI",
        "Z.AI",
    ].sort((a, b) => a.localeCompare(b));
</script>

<Accordion name="Openrouter Settings" styled>
    <Accordion className="mb-2" name={language.openRouterReasoning.title} styled>
        <span class="text-textcolor2 text-xs mb-2 block">{language.openRouterReasoning.note}</span>

        <span class="text-textcolor mb-2">{language.openRouterReasoning.effortTitle} <Help key="openRouterReasoningEffort"/></span>
        <SelectInput className="mb-2" bind:value={DBState.db.openRouterReasoning.effort}>
            <OptionInput value="">{language.openRouterReasoning.effortAuto}</OptionInput>
            <OptionInput value="none">{language.openRouterReasoning.effortNone}</OptionInput>
            <OptionInput value="minimal">{language.openRouterReasoning.effortMinimal}</OptionInput>
            <OptionInput value="low">{language.openRouterReasoning.effortLow}</OptionInput>
            <OptionInput value="medium">{language.openRouterReasoning.effortMedium}</OptionInput>
            <OptionInput value="high">{language.openRouterReasoning.effortHigh}</OptionInput>
            <OptionInput value="xhigh">{language.openRouterReasoning.effortXhigh}</OptionInput>
        </SelectInput>

        <span class="text-textcolor mb-2">{language.openRouterReasoning.maxTokensTitle} <Help key="openRouterReasoningMaxTokens"/></span>
        <NumberInput size="sm" marginBottom bind:value={DBState.db.openRouterReasoning.max_tokens}/>
    </Accordion>

    <div class="flex items-center mb-4">
        <Check bind:check={DBState.db.openrouterFallback} name={language.openrouterFallback}/>
    </div>
    <div class="flex items-center mb-4">
        <Check bind:check={DBState.db.openrouterMiddleOut} name={language.openrouterMiddleOut}/>
    </div>
    <div class="flex items-center mb-4">
        <Check bind:check={DBState.db.useInstructPrompt} name={language.useInstructPrompt}/>
    </div>

    <Accordion name={language.openrouterProviderOrder} help="openrouterProviderOrder" styled>
        {#each DBState.db.openrouterProvider.order as model, i}
            <span class="text-textcolor mt-4">
                {language.provider} {i + 1}
            </span>
            <OpenrouterProviderList bind:value={DBState.db.openrouterProvider.order[i]} options={openrouterProviders} />
        {/each}
        <div class="flex gap-2">
            <button class="bg-selected text-white p-2 rounded-md" onclick={() => {
                let value = DBState.db.openrouterProvider.order ?? []
                value.push('')
                DBState.db.openrouterProvider.order = value
        }}><PlusIcon /></button>
            <button class="bg-red-500 text-white p-2 rounded-md" onclick={() => {
                let value = DBState.db.openrouterProvider.order ?? []
                value.pop()
                DBState.db.openrouterProvider.order = value
        }}><TrashIcon /></button>
        </div>
    </Accordion>

    <Accordion name={language.openrouterProviderOnly} help="openrouterProviderOnly" styled>
        {#each DBState.db.openrouterProvider.only as model, i}
            <span class="text-textcolor mt-4">
                {language.provider} {i + 1}
            </span>
            <OpenrouterProviderList bind:value={DBState.db.openrouterProvider.only[i]} options={openrouterProviders} />
        {/each}
        <div class="flex gap-2">
            <button class="bg-selected text-white p-2 rounded-md" onclick={() => {
                let value = DBState.db.openrouterProvider.only ?? []
                value.push('')
                DBState.db.openrouterProvider.only = value
        }}><PlusIcon /></button>
            <button class="bg-red-500 text-white p-2 rounded-md" onclick={() => {
                let value = DBState.db.openrouterProvider.only ?? []
                value.pop()
                DBState.db.openrouterProvider.only = value
        }}><TrashIcon /></button>
        </div>
    </Accordion>

    <Accordion name={language.openrouterProviderIgnore} help="openrouterProviderIgnore" styled>
        {#each DBState.db.openrouterProvider.ignore as model, i}
            <span class="text-textcolor mt-4">
                {language.provider} {i + 1}
            </span>
            <OpenrouterProviderList bind:value={DBState.db.openrouterProvider.ignore[i]} options={openrouterProviders} />
        {/each}
        <div class="flex gap-2">
            <button class="bg-selected text-white p-2 rounded-md" onclick={() => {
                let value = DBState.db.openrouterProvider.ignore ?? []
                value.push('')
                DBState.db.openrouterProvider.ignore = value
        }}><PlusIcon /></button>
            <button class="bg-red-500 text-white p-2 rounded-md" onclick={() => {
                let value = DBState.db.openrouterProvider.ignore ?? []
                value.pop()
                DBState.db.openrouterProvider.ignore = value
        }}><TrashIcon /></button>
        </div>
    </Accordion>

    {#if DBState.db.useInstructPrompt}
        <ChatFormatSettings />
    {/if}
</Accordion>
