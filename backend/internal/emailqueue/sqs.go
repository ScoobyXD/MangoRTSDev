package emailqueue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

type sqsAPI interface {
	SendMessage(context.Context, *sqs.SendMessageInput, ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
	ReceiveMessage(context.Context, *sqs.ReceiveMessageInput, ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error)
	DeleteMessage(context.Context, *sqs.DeleteMessageInput, ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error)
}

type SQS struct {
	client   sqsAPI
	queueURL string
}

func NewSQS(client *sqs.Client, queueURL string) (*SQS, error) {
	return newSQS(client, queueURL)
}

func newSQS(client sqsAPI, queueURL string) (*SQS, error) {
	queueURL = strings.TrimSpace(queueURL)
	if client == nil || queueURL == "" {
		return nil, errors.New("email SQS client and queue URL are required")
	}
	return &SQS{client: client, queueURL: queueURL}, nil
}

func (q *SQS) Send(ctx context.Context, message Message) error {
	if q == nil {
		return errors.New("email SQS sender is not configured")
	}
	if err := message.Validate(); err != nil {
		return err
	}
	body, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("marshal email work message: %w", err)
	}
	_, err = q.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:               aws.String(q.queueURL),
		MessageBody:            aws.String(string(body)),
		MessageGroupId:         aws.String(message.GroupID()),
		MessageDeduplicationId: aws.String(message.DeduplicationID()),
	})
	if err != nil {
		return fmt.Errorf("send email work message: %w", err)
	}
	return nil
}

func (q *SQS) Receive(ctx context.Context) (Delivery, bool, error) {
	output, err := q.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
		QueueUrl:                    aws.String(q.queueURL),
		MaxNumberOfMessages:         1,
		WaitTimeSeconds:             int32(ReceiveWaitTime.Seconds()),
		MessageSystemAttributeNames: []types.MessageSystemAttributeName{types.MessageSystemAttributeNameApproximateReceiveCount},
	})
	if err != nil {
		return Delivery{}, false, fmt.Errorf("receive email work message: %w", err)
	}
	if len(output.Messages) == 0 {
		return Delivery{}, false, nil
	}
	item := output.Messages[0]
	if item.Body == nil || item.ReceiptHandle == nil {
		return Delivery{}, false, errors.New("received email work message is missing its body or receipt handle")
	}
	var message Message
	if err := json.Unmarshal([]byte(*item.Body), &message); err != nil {
		return Delivery{}, false, fmt.Errorf("decode email work message: %w", err)
	}
	if err := message.Validate(); err != nil {
		return Delivery{}, false, err
	}
	receiveCount, err := strconv.Atoi(item.Attributes[string(types.MessageSystemAttributeNameApproximateReceiveCount)])
	if err != nil || receiveCount < 1 {
		return Delivery{}, false, errors.New("received email work message has no valid receive count")
	}
	return Delivery{Message: message, ReceiptHandle: *item.ReceiptHandle, ReceiveCount: receiveCount}, true, nil
}

func (q *SQS) Delete(ctx context.Context, receiptHandle string) error {
	receiptHandle = strings.TrimSpace(receiptHandle)
	if receiptHandle == "" {
		return errors.New("email work message receipt handle is required")
	}
	_, err := q.client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
		QueueUrl:      aws.String(q.queueURL),
		ReceiptHandle: aws.String(receiptHandle),
	})
	if err != nil {
		return fmt.Errorf("delete email work message: %w", err)
	}
	return nil
}
