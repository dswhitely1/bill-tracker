import {
  ValidationArguments, ValidationOptions, registerDecorator,
} from 'class-validator';

export function MaxBytes(limit: number, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxBytes',
      target: object.constructor,
      propertyName,
      constraints: [limit],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          return Buffer.byteLength(value, 'utf8') <= (args.constraints[0] as number);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must not exceed ${args.constraints[0]} bytes`;
        },
      },
    });
  };
}
