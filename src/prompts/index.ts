// Logger import removed - not used in this file

export interface DeveloperPrompt {
	id: string;
	title: string;
	category: 'coding' | 'debugging' | 'code-review' | 'documentation' | 'testing' | 'refactoring' | 'architecture';
	description: string;
	prompt: string;
	tags: string[];
	difficulty: 'beginner' | 'intermediate' | 'advanced';
	useCase: string;
	example?: string;
}

export const DEVELOPER_PROMPTS: DeveloperPrompt[] = [
	// Coding Prompts
	{
		id: 'code-1',
		title: 'Generate Clean Code',
		category: 'coding',
		description: 'Generate clean, readable, and maintainable code',
		prompt: `Write clean, production-ready code for the following requirement:

[REQUIREMENT]

Requirements:
- Follow SOLID principles
- Use meaningful variable and function names
- Add appropriate comments for complex logic
- Handle edge cases and errors gracefully
- Optimize for performance where applicable
- Include type annotations (if applicable)

Provide the code with a brief explanation of the approach.`,
		tags: ['clean-code', 'best-practices', 'production-ready'],
		difficulty: 'intermediate',
		useCase: 'When you need to write new code or refactor existing code to be more maintainable'
	},
	{
		id: 'code-2',
		title: 'API Integration Helper',
		category: 'coding',
		description: 'Generate code for API integration with error handling',
		prompt: `Create a robust API integration for the following endpoint:

[API_ENDPOINT]
[API_DOCUMENTATION]

Requirements:
- Implement proper error handling and retry logic
- Add request/response validation
- Include rate limiting considerations
- Handle authentication if required
- Add comprehensive logging
- Include unit tests

Provide the implementation with usage examples.`,
		tags: ['api', 'integration', 'error-handling', 'testing'],
		difficulty: 'intermediate',
		useCase: 'When integrating with external APIs or services'
	},

	// Debugging Prompts
	{
		id: 'debug-1',
		title: 'Debug Code Issues',
		category: 'debugging',
		description: 'Systematic approach to debugging code problems',
		prompt: `Help me debug the following code issue:

[CODE_SNIPPET]
[ERROR_MESSAGE]
[EXPECTED_BEHAVIOR]
[ACTUAL_BEHAVIOR]

Please provide:
1. Root cause analysis
2. Step-by-step debugging approach
3. Potential fixes with explanations
4. Prevention strategies for similar issues
5. Testing recommendations

Focus on systematic debugging rather than quick fixes.`,
		tags: ['debugging', 'troubleshooting', 'root-cause-analysis'],
		difficulty: 'intermediate',
		useCase: 'When encountering bugs or unexpected behavior in code'
	},
	{
		id: 'debug-2',
		title: 'Performance Debugging',
		category: 'debugging',
		description: 'Identify and fix performance bottlenecks',
		prompt: `Analyze and optimize the performance of this code:

[CODE_SNIPPET]
[PERFORMANCE_ISSUE_DESCRIPTION]

Please provide:
1. Performance bottleneck identification
2. Profiling recommendations
3. Optimization strategies
4. Code improvements with explanations
5. Performance monitoring suggestions
6. Benchmarking approach

Include both algorithmic and implementation optimizations.`,
		tags: ['performance', 'optimization', 'profiling', 'benchmarking'],
		difficulty: 'advanced',
		useCase: 'When code is running slowly or consuming too many resources'
	},

	// Code Review Prompts
	{
		id: 'review-1',
		title: 'Comprehensive Code Review',
		category: 'code-review',
		description: 'Thorough code review checklist and feedback',
		prompt: `Perform a comprehensive code review for the following code:

[CODE_SNIPPET]

Review criteria:
- Code quality and readability
- Security vulnerabilities
- Performance implications
- Maintainability and scalability
- Testing coverage
- Documentation quality
- Best practices adherence
- Potential bugs or edge cases

Provide:
1. Overall assessment (1-10 scale)
2. Critical issues that must be fixed
3. Suggestions for improvement
4. Positive aspects to maintain
5. Specific recommendations with examples`,
		tags: ['code-review', 'quality', 'security', 'best-practices'],
		difficulty: 'intermediate',
		useCase: 'Before merging code or during peer review process'
	},

	// Documentation Prompts
	{
		id: 'doc-1',
		title: 'API Documentation Generator',
		category: 'documentation',
		description: 'Generate comprehensive API documentation',
		prompt: `Generate comprehensive API documentation for the following code:

[API_CODE]

Include:
1. Endpoint descriptions and parameters
2. Request/response examples
3. Error codes and handling
4. Authentication requirements
5. Rate limiting information
6. Usage examples in multiple languages
7. SDK/client library information

Format as clear, developer-friendly documentation.`,
		tags: ['documentation', 'api', 'developer-experience'],
		difficulty: 'intermediate',
		useCase: 'When creating or updating API documentation'
	},
	{
		id: 'doc-2',
		title: 'Code Comments Generator',
		category: 'documentation',
		description: 'Generate meaningful code comments and documentation',
		prompt: `Add comprehensive comments and documentation to this code:

[CODE_SNIPPET]

Requirements:
- Explain complex logic and algorithms
- Document function parameters and return values
- Add inline comments for non-obvious code
- Include usage examples where helpful
- Document any assumptions or limitations
- Add JSDoc/docstring format if applicable

Make the code self-documenting and easy to understand.`,
		tags: ['comments', 'documentation', 'readability'],
		difficulty: 'beginner',
		useCase: 'When code needs better documentation or comments'
	},

	// Testing Prompts
	{
		id: 'test-1',
		title: 'Unit Test Generator',
		category: 'testing',
		description: 'Generate comprehensive unit tests',
		prompt: `Generate comprehensive unit tests for the following code:

[CODE_SNIPPET]

Requirements:
- Test all public methods and functions
- Include edge cases and error conditions
- Test both positive and negative scenarios
- Mock external dependencies
- Achieve high code coverage
- Use descriptive test names
- Include setup and teardown if needed

Provide tests in the same language as the code.`,
		tags: ['testing', 'unit-tests', 'coverage', 'mocking'],
		difficulty: 'intermediate',
		useCase: 'When writing tests for new or existing code'
	},
	{
		id: 'test-2',
		title: 'Integration Test Scenarios',
		category: 'testing',
		description: 'Design integration test scenarios',
		prompt: `Design integration test scenarios for this system:

[SYSTEM_DESCRIPTION]
[COMPONENTS_INVOLVED]

Create test scenarios for:
1. Happy path workflows
2. Error handling and recovery
3. Performance under load
4. Data consistency
5. Security boundaries
6. Third-party integrations
7. Database transactions

Include test data setup and expected outcomes.`,
		tags: ['integration-tests', 'system-testing', 'scenarios'],
		difficulty: 'advanced',
		useCase: 'When designing integration tests for complex systems'
	},

	// Refactoring Prompts
	{
		id: 'refactor-1',
		title: 'Code Refactoring Assistant',
		category: 'refactoring',
		description: 'Refactor code for better maintainability',
		prompt: `Refactor the following code to improve maintainability and readability:

[CODE_SNIPPET]

Focus on:
- Reducing complexity and improving readability
- Extracting reusable components
- Eliminating code duplication
- Improving naming conventions
- Applying design patterns where appropriate
- Maintaining existing functionality
- Adding proper error handling

Provide the refactored code with explanations of changes.`,
		tags: ['refactoring', 'maintainability', 'clean-code', 'design-patterns'],
		difficulty: 'intermediate',
		useCase: 'When improving existing code without changing functionality'
	},

	// Architecture Prompts
	{
		id: 'arch-1',
		title: 'System Architecture Design',
		category: 'architecture',
		description: 'Design scalable system architecture',
		prompt: `Design a scalable architecture for the following requirements:

[REQUIREMENTS]
[CONSTRAINTS]
[EXPECTED_SCALE]

Consider:
- Scalability and performance
- Security and data protection
- Maintainability and modularity
- Technology stack recommendations
- Database design
- API design
- Monitoring and logging
- Deployment strategy

Provide a high-level architecture diagram and detailed explanations.`,
		tags: ['architecture', 'scalability', 'system-design', 'microservices'],
		difficulty: 'advanced',
		useCase: 'When designing new systems or major system overhauls'
	}
];

/**
 * Get prompts by category
 */
export function getPromptsByCategory(category: DeveloperPrompt['category']): DeveloperPrompt[] {
	return DEVELOPER_PROMPTS.filter(prompt => prompt.category === category);
}

/**
 * Get prompts by difficulty level
 */
export function getPromptsByDifficulty(difficulty: DeveloperPrompt['difficulty']): DeveloperPrompt[] {
	return DEVELOPER_PROMPTS.filter(prompt => prompt.difficulty === difficulty);
}

/**
 * Search prompts by tags or keywords
 */
export function searchPrompts(query: string): DeveloperPrompt[] {
	const lowercaseQuery = query.toLowerCase();
	return DEVELOPER_PROMPTS.filter(prompt => 
		prompt.title.toLowerCase().includes(lowercaseQuery) ||
		prompt.description.toLowerCase().includes(lowercaseQuery) ||
		prompt.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery)) ||
		prompt.useCase.toLowerCase().includes(lowercaseQuery)
	);
}

/**
 * Get random prompt for daily inspiration
 */
export function getRandomPrompt(): DeveloperPrompt {
	const randomIndex = Math.floor(Math.random() * DEVELOPER_PROMPTS.length);
	return DEVELOPER_PROMPTS[randomIndex]!;
}

/**
 * Format prompt for Telegram display
 */
export function formatPromptForTelegram(prompt: DeveloperPrompt, showFullPrompt: boolean = false): string {
	const difficultyEmoji = {
		beginner: '🟢',
		intermediate: '🟡',
		advanced: '🔴'
	};

	const categoryEmoji = {
		coding: '💻',
		debugging: '🐛',
		'code-review': '👀',
		documentation: '📚',
		testing: '🧪',
		refactoring: '🔧',
		architecture: '🏗️'
	};

	let message = `**${categoryEmoji[prompt.category]} ${prompt.title}**\n`;
	message += `${difficultyEmoji[prompt.difficulty]} ${prompt.difficulty.toUpperCase()}\n\n`;
	message += `📝 **Description:** ${prompt.description}\n\n`;
	message += `🎯 **Use Case:** ${prompt.useCase}\n\n`;
	message += `🏷️ **Tags:** ${prompt.tags.map(tag => `#${tag}`).join(' ')}\n\n`;

	if (showFullPrompt) {
		message += `**📋 Ready-to-Copy Prompt:**\n\n`;
		message += `\`\`\`\n${prompt.prompt}\n\`\`\`\n\n`;
	} else {
		message += `**📋 Prompt Preview:**\n`;
		message += `\`\`\`\n${prompt.prompt.substring(0, 200)}...\n\`\`\`\n\n`;
		message += `💡 *Use /prompt ${prompt.id} to see the full prompt*`;
	}

	return message;
}

/**
 * Get prompts formatted for Telegram by category
 */
export function getPromptsForTelegramByCategory(category: DeveloperPrompt['category']): string {
	const prompts = getPromptsByCategory(category);
	
	if (prompts.length === 0) {
		return `No prompts found for category: ${category}`;
	}

	let message = `**${category.toUpperCase()} PROMPTS** (${prompts.length} available)\n\n`;
	
	prompts.forEach((prompt, index) => {
		message += `${index + 1}. **${prompt.title}**\n`;
		message += `   ${prompt.description}\n`;
		message += `   🎯 ${prompt.useCase}\n\n`;
	});

	message += `💡 *Use /prompt [id] to get the full prompt*`;
	
	return message;
}
