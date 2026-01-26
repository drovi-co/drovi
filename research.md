ou are probably thinking of AI memory in the wrong way.

Over the last few years, we've all seen a lot of absolutely world-changing trends in AI. Things that totally changed the way we interact with computers today. The first one was data (models start getting smarter), then it was inference (everyone is able to run them), and vector databases/RAG. Now there are agents everywhere (with claude code).  So,,, what's next?
I believe that the next big inflection point is memory. And by memory, I mean truly magical personalization. A feeling that the user gets, when their assistant will proactively bring up things that they would never have expected. When context lengths are no longer a concern, and people can just have long running, thoughtful conversations with their assistant.
I believe that this true personalization can be brought in some beautifully simple ways. 
But first, let's talk about what the industry is getting wrong. 
Vector databases/ RAG is NOT memory.
RAG is just taking some raw info, embedding it, and making it searchable. 

The top match comes back, and LLM uses it to answer a question. 
It's a single step. It's stateless, unversioned, doesn't "evolve" with the user. Doesn't preserve temporality (understanding of time).

Memory evolves, updates, and derives/learns new information. 

Let's take a scenario.

Day 1: "I love Adidas sneakers"
Day 30: "My Adidas broke after a month, terrible quality"
Day 31: "I'm switching to Puma"
Day 45: "What sneakers should I buy?"
RAG will give the wrong results.

# RAG sees these as isolated embeddings
query = "What sneakers should I buy?"

# Semantic search finds closest match
result = vector_search(query)
# Returns: "I love Adidas sneakers" (highest similarity)

# Agent recommends Adidas 🤦
Memory fixes this. 

# Supermemory understands temporal context
query = "What sneakers should I buy?"

# Memory retrieval considers:
# 1. Temporal validity (Adidas preference is outdated)
# 2. Causal relationships (broke → disappointment → switch)
# 3. Current state (now prefers Puma)

# Agent correctly recommends Puma ✅

Apart from this, RAG doesn't 'forget' irrelevant information.  If i had an exam when I was in 10th grade that I was really scared about, that is no longer even relevant to my day-to-day life. Why would I want the AI to remember that?
The real way to do this well would be to get the "best of all worlds" - that is, hybrid search. we have a great documentation page that explains this in much higher detail. 
Agentic discovery / Filesystem search is stupid way of doing memory
A knee-jerk reaction to this would be "Oh, let the agent look through all the information and let it find out what to do!"
This will work. But is this what the world expects? Agentic discovery would take an agent atleast 10 seconds - let's say, even 1 full second to look through all the info it needs. Unfortunately, this is too slow with most of the real world use cases. 
That's too slow, because memory is in the hot path of an 'agent lifetime'. This is even before the agent even starts saying anything useful. Users don't want their agents slow. they want them fast.
AT BEST memory should take about 200-400 MILLISECONDS.
The added cost here is that this would be expensive to do at scale. Memory is something you want to reference on every single conversation turn. Running an agentic search would almost certainly be unaffordable, eventually. 
This remains a concern with context dumping, because you are 
1. paying a lot for little work done, and 
2. almost always hallucinating the model. 
3. The time to first byte is still, really slow.
And what about compaction, you ask?
Compaction is great for coding agents because all the information is in a structured, single session that you are compacting. You cannot really personalize just with compaction, because personalization is all about the little details.
The beautifully simple architecture - supermemory.
So, memory is important. It should be fast. it should scale, and not be expensive. We understand the constraints now.
But how do we build it? At supermemory, we have been thinking a lot about the best way to approach this memory problem, and build it like the human brain. https://supermemory.ai/blog/memory-engine/
1. A vector-graph architecture to track knowledge change. 

￼
A Context graph for AI - learning and evolving with a user.
We don't approach graphs the "traditional" way - No (entity, relation, entity) triplets, no long traversal times. 
The supermemory graph is a simple way to track how facts and knowledge about a single entity changes, over time.
It automatically updates, derives, and extends on top of the information it has. It's all facts, since there's only one "real" entity - the main user we are trying to understand.

Updates: Information Changes

Memory 1: "Alex works at Google as a software engineer"
Memory 2: "Alex just started at Stripe as a PM"
         ↓
Memory 2 UPDATES Memory 1
Derives: Sleep-time compute for an agent

Memory 1: "Alex is a PM at Stripe"
Memory 2: "Alex frequently discusses payment APIs and fraud detection"
         ↓
Derived: "Alex likely works on Stripe's core payments product"
This, paired with automatic forgetting, makes this approach a really, really good primitive for AI systems.

￼
2. Memory is not only retrieval!!! The magic of User Profiles
Traditionally, memory systems have relied on retrieving relevant information BEFORE responding.
However, this doesn't really work for "non-literal" questions. Many times, the user would say something really generic, like a "Hello!", or ask about something that not implicitly mentioned, ever, but the agent knows just enough to answer the question. 

￼
So, even saying a "Hello! I am really sad" should bring up "Hey, how's it going with that new customer now?". Not some generic-ahh response.
We built something called user profiles, which gives the agent a "default context" it should ALWAYS know about a user. 
Think of it as a RAM layer, with both "static" (things the agent should know by DEFAULT)  - like the name of the user, their age, etc, and "dynamic" - the episodic / currently-ongoing-endeavours of the user.

STATIC CONTEXT (always true unless explicitly updated)
- Name: Dhravya
- Location: San Francisco
- Role: Founder & CEO of Supermemory (AI memory + context platform)
- Age range: 18–25
- Interests: AI infrastructure, developer tools, vector search, PostgreSQL

DYNAMIC CONTEXT (things Dhravya has been talking about recently)
- Currently working on: a "Customer Context Graph" for consolidating customer data.
- Actively optimizing: inference cost for Claude and other LLMs.
- Exploring: migrating speech-to-speech from OpenAI to Gemini Live.
- Recent preference change: Adidas sneakers broke → switched preference to Puma.
- Mood: occasionally stressed about infra costs and scale.
This brings out a new way of personalization. Pair this with a retrieval step, and you always have a really personal assistant.
3. Getting the best of both worlds:  Hybrid retrieval
Just retrieval is great, and getting the right 'density' of memories extracted will never really happen. So, we also give LLM chunks, if there's no memories associated with them but still may be relevant.
Memories are always fresh, so they are given a higher priority. But to get just the right detail in the memory generation is crucial for us, hence, we only extract what's absolutely needed, and return the chunks anyways on query time.
Paired with user profiles, this makes sure that the agent has all the context it needs (without giving too much!!!!) to answer a question.




Someone needs to build a company around Customer Context Graph.

Collect all the threads – emails, meeting transcripts, slack messages, contracts, deliverables, detail, info, and config – from your customers into context that can be explored and queried by agents.

This info is scattered between CRMs, ticketing systems, note takers, product, landing pages – it's inherently cross platform information. You need a new solution. Kind of how Segment did it trad SaaS apps.

With this context, you can fire up Claude Cowork or similar for ad-hoc work or build extremely powerful agent automation flows. Expose the context as skills, MCP, and file system.

Even better if you build it as open-source with a hosted option so people can take it on-prem as needed. Create a connector ecosystem around it. This will power every single next-gen AI-native full-stack business.

Sort of like the context graph (@ashugarg @JayaGup10 ) that has been discussed recently but I'm thinking something very concrete: "Get me all the context about this particular customer."

A customer-level, cross-system context substrate that agents can explore and act on





￼
The Trillion Dollar Hole in Context Graphs



￼
dei
@parcadei
·
23 Jan
The trillion-dollar bet on context graphs has a hole. Six theorists and a Nobel laureate saw it decades ago...

￼
Even Sam & Dean won't be able to save us from this one
If you've read Part 1 - a synthesis of the ongoing debate about "context graphs" - you can skip this section. 

For those who can't be bothered to read a 3,000 word synthesis, I'll attempt to give you a 300 word version, you're welcome.
People claim that 'agents will become systems of record' (basically a CRM, ERP, etc). @jaminball disagrees - says that existing Systems of Records and lakehouses will be the home of agents who query them via API.
@JayaGup10 points out it's one half of the coin; for agents to be effective we need decision traces - why something was done. And operational roles (DevOps, RevOps, etc) are the highest signal because they're the human glue.
@akoratana replies that we can build them by having agents explore and build world models - compressed representations of the environment that encode how decisions unfold and entities interact.
@KirkMarple  disagrees and says we have 20 years of existing work on entity resolution but the hard part is temporal validity, decision traces, and fact resolution - knowing what's canonical when sources conflict.
@TrustSpooky points out we don't actually need a specific schema. An ontology is just a machine-parsable data structure that shows entities, relationships, and facts. Context Graphs are a methodology, not a specification - use whatever works.
@GilFeig  says hold up, you're all missing the point - the hardest part is operational efficiency. How do you know what to load, and when to load it? No one's thinking about cost, latency, rate limits, or context windows.
I @parcadei chime in with: it's not a graph, it's a flywheel - because all of them are right, and each is really just describing a distinct step in a compounding loop.
Congratulations, you're all caught up. I've now proved that articles are useless because I could've compressed 3,000 words into ~300 and written a thread.

￼
And yet, I will continue writing this article...
Why? 
Because you can only compress what you understand. 
A lot of people said the “flywheel framing” felt great, that it fit the concept far better than being described as a graph. 

And I’ll be honest, this was a great boost for my ego. But the voices in my head won't let me rest. They whisper: you know better. 

I did try and tell them it was a synthesis article - but hey, time for ego death.

See, the problem is that context graphs have a hole. The idea might be in its infancy, but the hole has been there for 70 years.

￼
The flywheel sounds great on paper:  

Ingest → Store → Resolve → Retrieve → Serve → Capture → Compound. 

Each rotation increases "context clarity."

And everyone’s debating how to capture decisions, how to build agent memory, and how we can use existing ontologies to make the job easier.
But there’s a problem nobody’s talking about that was solved, or rather, proven hard, if not unsolvable - decades ago.

￼
SYSTEMS OF PROFOUND KNOWLEDGE

￼

Meet W.Edwards Deming - the father of the quality movement. He helped rebuild the Japanese industry and is credited with transforming Japan into an economic powerhouse. Toyota's production system has Deming’s fingerprints all over it. 
You have to understand how the various processes and interrelated parts of an organisation work together. And if you focus on optimising singular parts, you will destroy the whole. 

Knowledge of Variation

You need to understand how and why quality and performance will vary across the organisation. 

Because not all change is signal, and reacting to noise makes things worse.

Theory of Knowledge
Deming clarifies that information doesn’t equal knowledge. 

Knowledge comes from having a theory which is a framework that helps us explain a phenomenon and predict what will happen in the future in different conditions. 

And without theory, experience doesn’t teach you anything.
Psychology

Most systems involve people, and for you to effectively manage the system you need to understand human psychology. This entails everything from intrinsic motivation down to incentives.
His key insight was that a system cannot understand itself from the inside, and his solution was using the system of profound knowledge (a deep understanding of an organisation or its processes) as a lens to solve this which is done by understanding the 4 interconnected parts.
But what does this have to do with Context Graphs? 
The assumption is that “agents” will use context graphs inside the system to undertake specific work. 

And the issue with this idea is that an LLM powered agent is going to inherit the blindspots. 

@JayaGup10  points this out when she says that “But these agents inherit their parent’s architectural limitations. Salesforce is built on current state storage: it knows what the opportunity looks like now, not what it looked like when the decision was made.”

But the problem is that it’s not just architectural limitations that agents inherit, it’s also the system's confusion about itself.

At this point, it’s probably helpful if I explain what I mean by a system, otherwise it starts to get a bit anthropomorphic.
A system is essentially the 'box' in which all the processes, workers, tools, and decisions operate.

The organisation is a system.

A department is a system within a system.

And these boxes interact with other boxes outside - suppliers, customers, regulators, competitors.
Deming's point: you can't understand the box from inside the box.
And here we revisit @akoratana point: Agents as informed works outputting a world model.
I get it, the idea is seductive; walk enough paths, compress the observations and eventually get a representation that captures the causal structure - how things actually work.
But here’s the problem, LLMs don’t build causal models, they pattern match on text. World models are supposed to maintain state, predict dynamics and support counterfactual reasoning i.e. “If we do X, what happens to Y?” 

An LLM powered agent isn’t going to do that on its merry path across the organisation. Instead, it will record symptoms not causes, correlations not causal structure, what people said happened not why it happened.

You can't compress your way to understanding if the raw data lacks causal structure.

Animesh even acknowledges it: "You can't capture reasoning about things you can't see." 

But then makes the unfortunate assumption that agents walking through the org will somehow see what the org can't see about itself but unfortunately, that's not how blindspots work.
"Ah," says the context graph enthusiast, "but this is exactly why we need decision trace capture. If we capture the decisions - the reasoning, the why, the raison d'être - we can build better causal world models."
Ok, let’s talk about that…

￼
Meet Donald J Wheeler, Deming’s student and associate for 20+ years who taught statistical process control for 40+ years.

His core insight was that all data contains noise, only some data contains signal and to capture it you need to filter out noise.
Yes I know, it’s clearly obvious in 2026 but just humour me for a few more paragraphs.
He outlined two types of variations: common cause and special cause.

Common cause was random variation inherent to the system which meant the process was stable and just fluctuating within its natural limits

Special cause meant something actually changed, and an assignable cause exists.

Common Cause = Noise and Special Cause = Signal.
The tool he used was process behaviour charts which I’m going to gloss over since its outside the point of the article, but the critical point was this:

Most organisations react to every single change as if it was a signal. 

If revenue drops by 3%, panic ensues. It’s up by 5%, let's throw a party for the new CEO who’s clearly a once in a generation genius. 

But if both are within normal variation, you’re just reacting to noise.
And guess what, by reacting to noise you introduce more variation by “fixing”things that weren't broken.

Now, back to context graphs.

@akoratana example was if the timeout is now 30 seconds, and previously it was 5 seconds, but no one captures the reasoning, we're missing what will make the agents good.

The problem is that was the latency spike that triggered the change a signal or noise?

If it was noise (normal variation) then the decision was a reaction to randomness and you’ve captured a garbage decision with perfect fidelity. 

Most business decisions are reactions to noise, without Wheeler’s filter, your context graph or flywheel compounds the organisation's flinches.
“Ok fine, but what if we only capture the signal decisions” the context graph enthusiast counters, “the real special cause stuff - then we’re good right?”  

Not really…

￼
Meet Gary Klein, a research psychologist who pioneered Naturalistic Decision Making. 

The quick and easy of it is that he studies how people actually do make decisions in the real world. 

People like firefighters, doctors, military commanders; people in high-stakes, time pressured and messy situations.

His big finding was that:
Experts don’t decide the way classical decision theory thinks they do.

Classical theory: 

List options → Weigh pros/cons → Calculate expected utility → Choose optimal
What experts actually do is something he calls Recognition-Primed Decision (RPD)
Experts don't analyse consciously, but unconsciously recognise.
1. They see a situation
2. Pattern-match it to something they've seen before
3. Mentally simulate the first viable option ("if I do X, will it work?")
4. If it works in their head, they do it
5. If not, they try the next pattern
They're not comparing options, instead they're recognising internally which ’type’ of situation this is, and running with the typical response for that type.
But this only works because they have thousands of hours of feedback-rich experience, meaning they've seen enough situations to build an internal library of patterns.

The context graph enthusiast jumps out of his seat, “Aha! So we just need to map all the patterns!”

￼

No, because the ‘context graph/flywheel’ gives you retrieval but that isn’t the hard part, it’s recognition. 

The experts didn’t find similar cases, they knew which features of the situation matter.  

A junior analyst can retrieve “Last time revenue dipped, we cut market spend”. 

But only an expert recognises that “this dip has different characteristics, it’s seasonal not structural.  Cutting spend would be suicide”.

This is the salience problem; two situations can look similar on the surface but be fundamentally different on the inside.
When you grab and ask a firefighter "how did you know to evacuate?", they’ll just say "it felt wrong." 
They can't articulate the 47 micro-signals they processed unconsciously and the decision traces capture what was said, not what was known.
The reasoning that gets logged is the post-hoc rationalisation, not the actual pattern recognition that happened in the moment.

What this means is that even if you filter to ‘signal only based decisions’ and capture reasoning perfectly...

You still can’t transfer expertise because a context graph gives you a library of verdicts. 

Remember Deming's point that without theory, experience doesn't teach you anything? 

Klein took it one step further by showing the expert's 'theory' is their internal pattern library - and it lives in their head, not in a trace.

And that doesn't transfer via a database.

And here the squad of cognitive graph enthusiast encased in tactical gear burst into the room

“Fine, we’ll train LLMs on domain-specific data. We’ll run simulations, and the agent will develop the pattern library.”

￼
But hold on, I have a trap-card: Dark Magician Dibello, I call upon  you.
Meet Lia DiBello; cognitive scientist and founder of WTRI. Her big question was “can you accelerate expertise?” 

￼
"AI should be treated as 'a high-energy intern that needs to be taught and guided by human experts" - Lia Dibello
The military needed people to develop 10 years of expertise within 2 years, and leaned on Lia to figure out, which she did but with one caveat.
It’s possible, but just not through information transfer.Her core insight was that all great business experts share the same mental model structure which she calls the “the triad”: financial, operations and market dynamics.
The difference between an expert and the novice isn’t what they know but how it’s organised within their respective noggins.
Novices have fragmented knowledge, which means a lot of facts without structure. An expert has integrated knowledge, which means fewer individual facts but more structure.
So, why doesn’t information transfer work?

Let’s take Jim, and we give him every decision trace, case study, report and complete access to organisational data.

Why is it that after all of this, he’s still not an expert?

Because expertise isn’t about having information, it’s about having the right cognitive structure to make sense of the information.








So, how did Lia pull it off for the military?

[caveat:this is a birds eye overview, not 1:1]

She used strategic rehearsals:

1. Put the learner in a realistic scenario and ask “what happens next, what do you do?”

2. Give the immediate feedback, show them what actually happens.

3. If their prediction was wrong, what did they miss?

4. Now update their mental model to account for what they missed.

And now repeat this hundreds of times across varied scenarios.
It's not about giving them all of the information. Instead it's about forcing predictions, and then showing them the reality.

This causes the brain to reorganise how it structures knowledge and slowly but surely, they begin the road to becoming an expert.

“Wait a minute, isn’t this exactly what we do with LLMs, and fine-tuning?”

No, LLM fine-tuning or RLHF optimises for output similarity or outputs humans prefer, but DiBello’s method builds structural understanding. 

In the end for an LLM, it learns to mimic expert outputs, it doesn't learn why those outputs were right and so, doesn’t know which features mattered.

It’s the Klein problem: The LLM can retrieve/generate outputs that look like expert decisions, it can’t recognise which situations call for which approach. 

And in business, 'sometimes right' can mean 'expensively wrong’.

￼
And there’s one more bullet left in the gun…

Meet Herbert Simon and his pal, James March.

￼
Herbert Simon was one of the most influential social scientists of the 20th century, and he won a Nobel prize for his work on decision making. 

Classical economics assumes humans are ‘rational maximisers’ that know all the alternatives, compute all the consequences, and choose optimally. Essentially, it imagines we’re all Spock.

But Herbert laughs in the face of classical economists, humans can’t do any of that because of limited information, computation, and time. As well as conflicting goals.

His solution was simple, instead of optimising, humans satisfice. They search until they find something “good enough” and then stop.

And the threshold for “good enough” depends on who’s deciding, how tired they are, what they had for breakfast, political dynamics, and blah, blah and blah - you get the point.
And what’s this got to do with “context graphs”? 

There’s no optimal decision to learn from, every decision in the graph was “just good enough” for that person, at that moment. The threshold was arbitrary and contextual. 

You were never capturing organisational intelligence, you were capturing what Steve’s satisficing threshold was on Tuesday.

And now we segue to James March, an organisational theorist from Stanford with his Garbage Can Model of organisational decision-making.

The setup is simple, he studied universities and realised that they operate as ‘organised anarchies’ with:

Problematic preference: 
Goals are vague, inconsistency and discovered through action rather than guiding the latter

Unclear Technology: 
Nobody really knows how things work or what causes what

Fluid Participation: 
Who’s involved in any decision constantly changes.

This brings us to his Garbage Can Model.

￼

Organisations are garbage cans where four independent streams float around:

1. Problems - looking for decisions to attach to
2. Solutions - looking for problems to solve
3. Participants - looking for work to do
4. Choice Opportunities - meetings, deadlines, moments when decisions ‘have’ to be made.
And the brutal conclusion is that these streams operate independently and collide by temporal coincidence, not logic.
Most decisions are made without solving any problem, they just show up to the same meeting and the decision gets made.
Not because it was optimal but because it's 12:15 and Steve the support agent, needed to rush to get lunch
This means that the decision trace fundamentally isn’t a record of reasoning, it’s a post-hoc story the organisation tells itself to make the garbage can collision look rational.
And this breaks the ‘temporal validity’ idea. We can’t track when facts were true because the ‘facts’ were never coherent. 
You can’t build an event clock because the rational sequence that led to the decision never existed anywhere outside of your imagination. 
And you’re not capturing organisational intelligence, you’re capturing organisational fan-fiction.
On Palantir







Palantir embeds forward deployed engineers who work on site for months, untangling the messy human work of building ontologies, integrating data sources, uncovering constraints and so much more.

AI models don’t magically resolve corporate data that is contradictory, insecure and trapped inside systems that were never designed to talk to one another. People do, specifically engineers.

Palantir isn’t selling AI that replaces humans, they’re selling highly paid human consultants who do the ‘Deming/Wheeler/Klein/DiBello’ work manually. 

Because the gap between “we built an amazing AI model” and “this AI model is actually useful” is huge. 

And that gap gets filled by humans, not graphs.

Selling “context graphs” without an army of forward deployed engineers is selling the map without the territory. 

And so six theorists, one Nobel laureate and 70 years of research converge on: "the thing you're trying to capture doesn't exist in the form you imagine."

Here's what the context graph thesis is really saying:
"If we capture enough decision traces, we can replace employees with agents."
That is where the walk down the 'trillion-dollar opportunity road' takes you.

Because if you automate the knowledge worker and give the LLM enough context and it becomes the employee.
But here's what 70 years of organisational theory says back:
"The employee was never the problem."
Deming's Point 10 (from his 14 Points for Management) states that the "...bulk of the causes of low quality and low productivity belong to the system and thus lie beyond the power of the work force."
The sales rep making bad calls? System problem. 

The ops lead firefighting instead of improving? System problem. 

The manager reacting to noise? System problem.
Context graphs capture what employees did but they don't fix what made employees do it.
And now you've got agents making the same bad decisions, at scale, faster, with more confidence.
Congratulations you've automated the dysfunction.
Okay tough guy, what’s the solution?

￼
Context graphs are a governance problem wearing a data costume. You don't capture your way to discipline. You discipline your way to capture

The whole thesis is backwards. "Capture → Compound → Intelligence emerges" doesn't work because it's fundamentally misaligned with 70 years of research.
What you actually need is:
1. Wheeler's filter - only capture signal
2. Deming's outside view - understand the system
3. Klein's recognition - know what features matter
4. DiBello's structure - organise the knowledge properly
And then the graph becomes useful. But at that point, the humans already did the hard work. The graph is just documentation.
Which brings us to back to Palantir. They don't sell context graphs. They sell Forward Deployed Engineers who do the cognitive work, then document it on their platform.
The platform isn't the product. The humans are, the "context graph" is just the receipt.
And here we arrive at the bootstrapping paradox:

Organisations that could benefit most lack the discipline needed to implement it, while those that already have discipline don't need it as badly.

And those who spotted the problem, brought on Palantir.

In the end, the question isn’t “How do we build context graphs?”

It’s “How do we build organisational discipline that can leverage context graphs?”

And that’s a whole different problem.

But hey, at least now we know where the hole is.

And this means I'm going to have to write a part 3 for how to fix this problem doesn't it....

None of this would have been possible without the work of  @ejames_c  & commoncog.com 

Blame him for his excellent work that led me down this rabbit hole of connecting the dots...

￼
As always, if there are any inaccuracies, misquotations,  misrepresentations or misunderstandings - I'm claiming this was all AI generated.

