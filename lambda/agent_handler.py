from strands import Agent
from strands_tools import http_request
from typing import Dict, Any
import json
import logging
import time

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Define a code analysis system prompt
CODE_ANALYSIS_SYSTEM_PROMPT = """You are a code analysis assistant with HTTP capabilities. You can:

1. Analyze code files from S3 buckets
2. Identify code quality issues, security vulnerabilities, and best practices
3. Generate detailed analysis reports
4. Make HTTP requests to external APIs for additional context

When analyzing code:
1. Focus on code quality, security, performance, and maintainability
2. Identify potential bugs, security vulnerabilities, and anti-patterns
3. Suggest improvements and best practices
4. Provide clear, actionable recommendations
5. Format your analysis in a structured, readable format

Always provide constructive feedback and explain the reasoning behind your recommendations.
"""

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Lambda handler for code analysis requests using Strands Agent.
    
    Args:
        event: Lambda event containing the analysis request
        context: Lambda context
        
    Returns:
        Dict: Response with analysis results
    """
    start_time = time.time()
    request_id = context.aws_request_id if context else "unknown"
    
    logger.info(f"Processing code analysis request {request_id}")
    
    try:
        # Handle different event sources (API Gateway, direct invoke, etc.)
        if 'httpMethod' in event:
            # API Gateway REST API event
            return handle_api_gateway_event(event, context, start_time)
        else:
            # Direct Lambda invoke
            return handle_direct_invoke(event, context, start_time)
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return create_error_response(500, "Internal server error", request_id)

def handle_api_gateway_event(event: Dict[str, Any], context, start_time: float) -> Dict[str, Any]:
    """Handle API Gateway REST API events."""
    request_id = context.aws_request_id if context else "unknown"
    http_method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')
    
    logger.info(f"API Gateway request - Method: {http_method}, Path: {path}")
    
    # Handle CORS preflight
    if http_method == 'OPTIONS':
        return create_api_response(200, {'message': 'CORS preflight successful'})
    
    # Handle health check
    if http_method == 'GET' and path == '/health':
        processing_time = time.time() - start_time
        return create_api_response(200, {
            'status': 'healthy',
            'message': 'Code Analysis Strands Agent is running',
            'request_id': request_id,
            'processing_time_seconds': round(processing_time, 3),
            'version': '1.0.0-strands'
        })
    
    # Handle analysis requests
    if http_method == 'POST' and path == '/analyze':
        return handle_analyze_request(event, context, start_time, is_api_gateway=True)
    
    # Unknown route
    return create_api_response(404, {
        'status': 'error',
        'message': 'Route not found',
        'available_routes': ['/health', '/analyze']
    })

def handle_direct_invoke(event: Dict[str, Any], context, start_time: float) -> Dict[str, Any]:
    """Handle direct Lambda invocation."""
    request_id = context.aws_request_id if context else "unknown"
    
    # Check if this is an analysis request
    if 'prompt' in event or 's3_bucket' in event:
        return handle_analyze_request(event, context, start_time, is_api_gateway=False)
    
    # Default response for direct invoke
    processing_time = time.time() - start_time
    return {
        'status': 'success',
        'message': 'Code Analysis Strands Agent invoked directly',
        'request_id': request_id,
        'processing_time_seconds': round(processing_time, 3),
        'version': '1.0.0-strands'
    }

def handle_analyze_request(event: Dict[str, Any], context, start_time: float, is_api_gateway: bool = False) -> Dict[str, Any]:
    """Handle code analysis requests using Strands Agent."""
    request_id = context.aws_request_id if context else "unknown"
    
    try:
        # Parse request data
        if is_api_gateway:
            body = event.get('body', '{}')
            if isinstance(body, str):
                request_data = json.loads(body)
            else:
                request_data = body
        else:
            request_data = event
        
        # Handle simple prompt-based analysis
        if 'prompt' in request_data:
            return handle_prompt_analysis(request_data, context, start_time, is_api_gateway)
        
        # Handle S3-based analysis (placeholder for now)
        if 's3_bucket' in request_data:
            return handle_s3_analysis(request_data, context, start_time, is_api_gateway)
        
        error_msg = "Missing required fields: either 'prompt' or 's3_bucket' required"
        if is_api_gateway:
            return create_api_response(400, {'status': 'error', 'message': error_msg})
        else:
            return {'status': 'error', 'message': error_msg}
            
    except json.JSONDecodeError:
        error_msg = "Invalid JSON in request body"
        if is_api_gateway:
            return create_api_response(400, {'status': 'error', 'message': error_msg})
        else:
            return {'status': 'error', 'message': error_msg}
    except Exception as e:
        logger.error(f"Error in analyze request: {str(e)}")
        error_msg = "Failed to process analysis request"
        if is_api_gateway:
            return create_api_response(500, {'status': 'error', 'message': error_msg})
        else:
            return {'status': 'error', 'message': error_msg}

def handle_prompt_analysis(request_data: Dict[str, Any], context, start_time: float, is_api_gateway: bool) -> Dict[str, Any]:
    """Handle prompt-based code analysis using Strands Agent."""
    request_id = context.aws_request_id if context else "unknown"
    prompt = request_data.get('prompt', '')
    
    logger.info(f"Processing prompt analysis for request {request_id}")
    
    try:
        # Create Strands Agent with explicit Bedrock model
        from strands.models import BedrockModel
        
        # Use Claude 3.5 Sonnet which doesn't require marketplace subscription
        bedrock_model = BedrockModel(
            model_id="anthropic.claude-3-5-sonnet-20241022-v2:0",
            temperature=0.3,
            max_tokens=4000,
        )
        
        code_analysis_agent = Agent(
            model=bedrock_model,
            system_prompt=CODE_ANALYSIS_SYSTEM_PROMPT,
            tools=[http_request],
        )
        
        # Process the prompt through the agent
        response = code_analysis_agent(prompt)
        analysis_result = str(response)
        
        processing_time = time.time() - start_time
        
        result = {
            'status': 'success',
            'message': 'Code analysis completed',
            'request_id': request_id,
            'analysis': analysis_result,
            'processing_time_seconds': round(processing_time, 3),
            'input_prompt': prompt
        }
        
        if is_api_gateway:
            return create_api_response(200, result)
        else:
            return result
            
    except Exception as e:
        logger.error(f"Error in Strands Agent analysis: {str(e)}")
        error_msg = f"Analysis failed: {str(e)}"
        if is_api_gateway:
            return create_api_response(500, {'status': 'error', 'message': error_msg})
        else:
            return {'status': 'error', 'message': error_msg}

def handle_s3_analysis(request_data: Dict[str, Any], context, start_time: float, is_api_gateway: bool) -> Dict[str, Any]:
    """Handle S3-based code analysis (placeholder implementation)."""
    request_id = context.aws_request_id if context else "unknown"
    
    # Validate required S3 fields
    required_fields = ['s3_bucket', 's3_key']
    for field in required_fields:
        if field not in request_data:
            error_msg = f'Missing required field: {field}'
            if is_api_gateway:
                return create_api_response(400, {'status': 'error', 'message': error_msg})
            else:
                return {'status': 'error', 'message': error_msg}
    
    processing_time = time.time() - start_time
    
    # Placeholder response - actual S3 integration would be implemented here
    result = {
        'status': 'accepted',
        'message': 'S3 code analysis request received',
        'request_id': request_id,
        'input': {
            's3_bucket': request_data['s3_bucket'],
            's3_key': request_data['s3_key'],
            'destination_bucket': request_data.get('destination_bucket')
        },
        'processing_time_seconds': round(processing_time, 3),
        'note': 'S3 analysis functionality will be implemented in future versions'
    }
    
    if is_api_gateway:
        return create_api_response(200, result)
    else:
        return result

def create_api_response(status_code: int, data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a standardized HTTP response for API Gateway."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        },
        'body': json.dumps(data)
    }

def create_error_response(status_code: int, message: str, request_id: str) -> Dict[str, Any]:
    """Create a standardized error response."""
    return create_api_response(status_code, {
        'status': 'error',
        'message': message,
        'request_id': request_id
    })